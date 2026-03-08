import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Send, Mic, Loader2, Volume2, VolumeX, AudioWaveform, Square, X, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, ArrowDown, ChevronDown, Check, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { renderAnswerForSpeech, selectBestVoice, createUtterance, splitIntoSentences } from "@/lib/ttsUtils";
import { useChatHistory, ChatMessage, ConversationFilters, ChatSource, getDefaultFilters } from "@/hooks/useChatHistory";
import { MarkdownWithCitations } from "@/components/MarkdownWithCitations";
import { DocumentViewerModal } from "@/components/DocumentViewerModal";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TabPermissions } from "@/hooks/usePermissions";

interface Project {
  id: string;
  name: string;
}

interface TechnicianChatProps {
  hasDocuments: boolean;
  chunksCount: number;
  permissions: TabPermissions;
  showTabBar?: boolean;
  currentTab?: string;
  onTabChange?: (tab: string) => void;
  projectId?: string;
  projects?: Project[];
  currentProject?: Project | null;
  onProjectSwitch?: (project: Project) => void;
  tabSwitcher?: React.ReactNode;
}

// Source type now imported as ChatSource from useChatHistory

export const TechnicianChat = ({ hasDocuments, chunksCount, permissions, showTabBar, currentTab, onTabChange, projectId, projects, currentProject, onProjectSwitch, tabSwitcher }: TechnicianChatProps) => {
  const canWrite = permissions.write;
  const canDelete = permissions.delete;
  const [question, setQuestion] = useState("");
  const [documentViewer, setDocumentViewer] = useState<{ open: boolean; documentId: string; highlightText: string; filename: string; chunkIndex: number }>({ open: false, documentId: "", highlightText: "", filename: "", chunkIndex: 0 });
  const [isQuerying, setIsQuerying] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("google/gemini-2.5-flash-lite");
  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobileDevice);
  const { toast } = useToast();

  const {
    messages: chatHistory,
    filters: conversationFilters,
    conversations,
    activeConversationId,
    addMessage,
    updateFilters,
    startNewConversation,
    deleteConversation,
    switchConversation,
    ensureActiveConversation,
    renameConversation,
    reorderConversations,
    isLoading: isHistoryLoading
  } = useChatHistory(projectId);

  // Load filters from localStorage for the active conversation
  const getStoredFilters = useCallback((convId: string | null): ConversationFilters => {
    if (!convId || !projectId) return getDefaultFilters();
    try {
      const stored = localStorage.getItem(`chat-filters-${projectId}-${convId}`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return getDefaultFilters();
  }, [projectId]);

  const [currentFilters, setCurrentFilters] = useState<ConversationFilters>(() => 
    getStoredFilters(activeConversationId)
  );

  // When active conversation changes, load its filters from localStorage
  useEffect(() => {
    setCurrentFilters(getStoredFilters(activeConversationId));
  }, [activeConversationId, getStoredFilters]);

  // Persist filter changes to localStorage and conversation state
  const updateCurrentFilters = (newFilters: ConversationFilters) => {
    setCurrentFilters(newFilters);
    updateFilters(newFilters);
    if (activeConversationId && projectId) {
      localStorage.setItem(`chat-filters-${projectId}-${activeConversationId}`, JSON.stringify(newFilters));
    }
  };

  const [filtersLocked, setFiltersLocked] = useState(false);
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);

  // Don't auto-create conversations on mount - only ensure when user sends a message

  const [isConversationMode, setIsConversationMode] = useState(false);
  const [conversationState, setConversationState] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [isDictating, setIsDictating] = useState(false);
  const SILENCE_THRESHOLD_MS = 3000;

  const recognitionRef = useRef<any>(null);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceQueueRef = useRef<number>(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const conversationActiveRef = useRef(false);
  const dictationActiveRef = useRef(false);
  const dictationPartsRef = useRef<string[]>([]);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const ttsKeepAliveRef = useRef<NodeJS.Timeout | null>(null);
  const currentTranscriptRef = useRef<string>("");
  const abortCountRef = useRef<number>(0);
  const listeningWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionStartedRef = useRef<boolean>(false);
  const isProcessingVoiceRef = useRef<boolean>(false);
  const lastSubmittedTranscriptRef = useRef<string>("");
  const currentFiltersRef = useRef<ConversationFilters>(currentFilters);

  useEffect(() => {
    currentFiltersRef.current = currentFilters;
  }, [currentFilters]);

  // Dynamic project fields, dropdown options, roles, and document list for filters
  const [projectFields, setProjectFields] = useState<string[]>([]);
  const [fieldOptions, setFieldOptions] = useState<Record<string, string[]>>({});
  const [availableRoles, setAvailableRoles] = useState<{ role: string; displayName: string | null }[]>([]);
  const [projectDocuments, setProjectDocuments] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const fetchProjectFields = async () => {
      if (!projectId) { setProjectFields([]); return; }
      const { data } = await supabase.from('project_metadata_fields').select('field_name').eq('project_id', projectId).order('created_at');
      setProjectFields(data?.map(f => f.field_name) || []);
    };
    fetchProjectFields();
  }, [projectId]);

  useEffect(() => {
    const fetchDropdownOptions = async () => {
      const { data } = await supabase.from('dropdown_options').select('category, value').order('value');
      if (data) {
        const grouped: Record<string, string[]> = {};
        data.forEach(d => { if (!grouped[d.category]) grouped[d.category] = []; grouped[d.category].push(d.value); });
        setFieldOptions(grouped);
      }
    };
    fetchDropdownOptions();
  }, []);

  useEffect(() => {
    const fetchRoles = async () => {
      const { data } = await supabase.from('role_permissions').select('role, display_name').order('role');
      if (data) setAvailableRoles(data.map(r => ({ role: r.role, displayName: r.display_name })));
    };
    fetchRoles();
  }, []);

  useEffect(() => {
    const fetchProjectDocs = async () => {
      if (!projectId) { setProjectDocuments([]); return; }
      const { data } = await supabase.from('documents').select('id, filename').eq('project_id', projectId).order('filename');
      setProjectDocuments(data?.map(d => ({ id: d.id, name: d.filename })) || []);
    };
    fetchProjectDocs();

    // Subscribe to document changes to keep list fresh
    const channel = supabase.channel('assistant-docs-filter')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, fetchProjectDocs)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, scrollToBottom]);

  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 150);
  }, []);

  useEffect(() => {
    const initVoice = () => {selectedVoiceRef.current = selectBestVoice();};
    initVoice();
    if ('speechSynthesis' in window) {window.speechSynthesis.onvoiceschanged = initVoice;}
    return () => {
      if (silenceTimerRef.current) {clearTimeout(silenceTimerRef.current);silenceTimerRef.current = null;}
      if (ttsKeepAliveRef.current) {clearInterval(ttsKeepAliveRef.current);ttsKeepAliveRef.current = null;}
      if (listeningWatchdogRef.current) {clearTimeout(listeningWatchdogRef.current);listeningWatchdogRef.current = null;}
      stopListening();
      stopSpeaking();
    };
  }, []);

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) {clearTimeout(silenceTimerRef.current);silenceTimerRef.current = null;}
    dictationActiveRef.current = false;
    dictationPartsRef.current = [];
    if (recognitionRef.current) {try {recognitionRef.current.stop();} catch (e) {}recognitionRef.current = null;}
    setIsDictating(false);
    currentTranscriptRef.current = '';
  }, []);

  const stopSpeaking = useCallback(() => {
    if (ttsKeepAliveRef.current) { clearInterval(ttsKeepAliveRef.current); ttsKeepAliveRef.current = null; }
    if ('speechSynthesis' in window) {window.speechSynthesis.cancel();utteranceQueueRef.current++;}
    setIsSpeaking(false);
    setSpeakingMessageId(null);
    setConversationState((prev) => prev === "speaking" ? "idle" : prev);
  }, []);

  const speakText = useCallback((text: string, onComplete?: () => void, messageId?: string) => {
    if (!('speechSynthesis' in window)) {
      toast({ title: "TTS not supported", description: "Voice playback is not supported in this browser.", variant: "destructive" });
      onComplete?.();return;
    }
    window.speechSynthesis.cancel();
    // Clear any existing keepAlive
    if (ttsKeepAliveRef.current) { clearInterval(ttsKeepAliveRef.current); ttsKeepAliveRef.current = null; }
    const cleanText = renderAnswerForSpeech(text);
    const sentences = splitIntoSentences(cleanText);
    if (sentences.length === 0) {onComplete?.();return;}
    if (!selectedVoiceRef.current) {selectedVoiceRef.current = selectBestVoice();}
    const queueId = ++utteranceQueueRef.current;
    let currentIndex = 0;
    setIsSpeaking(true);
    if (messageId) setSpeakingMessageId(messageId);
    // Chrome workaround: pause/resume every 10s to prevent cutting out after ~15s
    ttsKeepAliveRef.current = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
    const cleanup = () => {
      if (ttsKeepAliveRef.current) { clearInterval(ttsKeepAliveRef.current); ttsKeepAliveRef.current = null; }
      setIsSpeaking(false);
      setSpeakingMessageId(null);
    };
    const speakNext = () => {
      if (queueId !== utteranceQueueRef.current) { cleanup(); return; }
      if (currentIndex >= sentences.length) { cleanup(); onComplete?.(); return; }
      const utterance = createUtterance(sentences[currentIndex], selectedVoiceRef.current);
      utterance.onend = () => {currentIndex++;speakNext();};
      utterance.onerror = (e) => {
        console.error('[TTS] Utterance error:', e);
        // On error, try to continue with next sentence instead of stopping
        if (currentIndex < sentences.length - 1) { currentIndex++; setTimeout(speakNext, 100); }
        else { cleanup(); onComplete?.(); }
      };
      window.speechSynthesis.speak(utterance);
    };
    speakNext();
  }, [toast]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {clearTimeout(silenceTimerRef.current);silenceTimerRef.current = null;}
  }, []);

  const startConversationListening = useCallback(() => {
    if (!conversationActiveRef.current) return;
    clearSilenceTimer();
    // Clear any previous watchdog
    if (listeningWatchdogRef.current) { clearTimeout(listeningWatchdogRef.current); listeningWatchdogRef.current = null; }
    recognitionStartedRef.current = false;

    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: "Speech recognition not supported", description: "Your browser doesn't support speech recognition.", variant: "destructive" });
      return;
    }
    // Clean up any lingering recognition instance
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) {}
      recognitionRef.current = null;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    currentTranscriptRef.current = '';
    let finalTranscript = '';
    recognition.onstart = () => {
      recognitionStartedRef.current = true;
      setConversationState("listening");
      abortCountRef.current = 0;
      // Clear watchdog since we successfully started
      if (listeningWatchdogRef.current) { clearTimeout(listeningWatchdogRef.current); listeningWatchdogRef.current = null; }
    };
    recognition.onresult = (event: any) => {
      clearSilenceTimer();
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimText += transcript;
        }
      }
      const display = (finalTranscript + interimText).trim();
      currentTranscriptRef.current = display;
      setQuestion(display);
      silenceTimerRef.current = setTimeout(() => {
        const transcript = currentTranscriptRef.current.trim();
        if (transcript && conversationActiveRef.current && !isProcessingVoiceRef.current) {
          // Prevent duplicate submission of same transcript
          if (transcript === lastSubmittedTranscriptRef.current) {
            console.warn('[Voice] Duplicate transcript detected, skipping');
            return;
          }
          if (recognitionRef.current) {try {recognitionRef.current.stop();} catch (e) {}recognitionRef.current = null;}
          isProcessingVoiceRef.current = true;
          lastSubmittedTranscriptRef.current = transcript;
          setConversationState("processing");
          setQuestion("");
          processConversationMessage(transcript);
        }
      }, SILENCE_THRESHOLD_MS);
    };
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      clearSilenceTimer();
      if (event.error === 'not-allowed') {
        toast({ title: "Microphone permission denied", description: "Please enable mic access in your browser.", variant: "destructive" });
        conversationActiveRef.current = false;
        setIsConversationMode(false);
        setConversationState("idle");
      } else if (event.error === 'no-speech' && conversationActiveRef.current) {
        recognitionRef.current = null;
        setTimeout(() => {if (conversationActiveRef.current) startConversationListening();}, 300);
      } else if (event.error === 'aborted') {
        recognitionRef.current = null;
        abortCountRef.current++;
        if (abortCountRef.current >= 3) {
          conversationActiveRef.current = false;
          setIsConversationMode(false);
          setConversationState("idle");
          toast({ title: "Voice not available", description: "Speech recognition is not available in this environment. Try a different browser.", variant: "destructive" });
        }
        return;
      } else if (conversationActiveRef.current) {
        recognitionRef.current = null;
        setTimeout(() => {if (conversationActiveRef.current) startConversationListening();}, 500);
      } else {recognitionRef.current = null;}
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      // Don't restart if we're currently processing a transcript or a silence timer is pending
      if (conversationActiveRef.current && !silenceTimerRef.current && !isProcessingVoiceRef.current) {
        setTimeout(() => {if (conversationActiveRef.current && !isProcessingVoiceRef.current) startConversationListening();}, 200);
      }
    };
    try {
      recognition.start();
    } catch (e) {
      console.error('[Voice] Failed to start recognition:', e);
      recognitionRef.current = null;
    }
    // Watchdog: if onstart doesn't fire within 3s, force restart
    listeningWatchdogRef.current = setTimeout(() => {
      if (conversationActiveRef.current && !recognitionStartedRef.current) {
        console.warn('[Voice] Watchdog: recognition did not start, restarting...');
        if (recognitionRef.current) {
          try { recognitionRef.current.abort(); } catch (e) {}
          recognitionRef.current = null;
        }
        setTimeout(() => { if (conversationActiveRef.current) startConversationListening(); }, 500);
      }
    }, 3000);
  }, [toast, clearSilenceTimer]);

  const processConversationMessage = useCallback(async (text: string) => {
    if (!hasDocuments) {
      toast({ title: "No documents indexed", description: "Please upload and index documents first.", variant: "destructive" });
      isProcessingVoiceRef.current = false;
      return;
    }
    const filtersAtSendTime = { ...currentFiltersRef.current };
    setFiltersLocked(true);
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: text.trim(), inputMode: "voice", timestamp: new Date() };
    addMessage(userMessage);
    setIsQuerying(true);
    
    
    try {
      // Ensure valid auth token before calling edge function
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
        setIsQuerying(false); setConversationState("idle"); isProcessingVoiceRef.current = false; return;
      }
      const currentSessionId = activeConversationId;
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: { question: text.trim(), documentType: filtersAtSendTime.docType || undefined, uploadDate: filtersAtSendTime.uploadDate || undefined, filterSite: filtersAtSendTime.site || undefined, equipmentType: filtersAtSendTime.equipmentType || undefined, equipmentMake: filtersAtSendTime.equipmentMake || undefined, equipmentModel: filtersAtSendTime.equipmentModel || undefined, isConversationMode: true, projectId: projectId || undefined, sessionId: currentSessionId || undefined, documentIds: filtersAtSendTime.documentIds?.length ? filtersAtSendTime.documentIds : undefined, dynamicMetadata: Object.keys(filtersAtSendTime.dynamicMetadata || {}).length ? filtersAtSendTime.dynamicMetadata : undefined, accessRole: filtersAtSendTime.accessRole || undefined, model: selectedModel }
      });
      if (error) throw error;
      const assistantMessage: ChatMessage = { id: `assistant-${Date.now()}`, role: "assistant", content: data.answer, inputMode: "voice", timestamp: new Date(), sources: data.sources || [] };
      addMessage(assistantMessage);
      isProcessingVoiceRef.current = false;
      if (data.answer && conversationActiveRef.current) {
        setConversationState("speaking");
        speakText(data.answer, () => {
          setFiltersLocked(false);
          lastSubmittedTranscriptRef.current = ""; // Reset dedup after full cycle
          if (conversationActiveRef.current) {setTimeout(() => {if (conversationActiveRef.current) startConversationListening();}, 300);}
        });
      } else {
        setFiltersLocked(false);
        lastSubmittedTranscriptRef.current = "";
        // Restart listening even if answer was empty
        if (conversationActiveRef.current) {setTimeout(() => {if (conversationActiveRef.current) startConversationListening();}, 300);}
      }
    } catch (error: any) {
      console.error("Error querying assistant:", error);
      toast({ title: "Error querying assistant", description: error.message || "An unexpected error occurred.", variant: "destructive" });
      isProcessingVoiceRef.current = false;
      lastSubmittedTranscriptRef.current = "";
      setFiltersLocked(false);
      if (conversationActiveRef.current) {setConversationState("idle");setTimeout(() => {if (conversationActiveRef.current) startConversationListening();}, 1000);}
    } finally {setIsQuerying(false);}
  }, [hasDocuments, chatHistory, addMessage, speakText, startConversationListening, toast]);

  const sendMessage = useCallback(async (text: string, inputMode: "text" | "dictation") => {
    stopListening();
    if (!hasDocuments) {toast({ title: "No documents indexed", description: "Please upload and index documents first.", variant: "destructive" });return;}
    if (!text.trim()) return;
    const filtersAtSendTime = { ...currentFiltersRef.current };
    setFiltersLocked(true);
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: text.trim(), inputMode, timestamp: new Date() };
    addMessage(userMessage);
    setQuestion("");
    setIsQuerying(true);
    
    
    try {
      // Ensure valid auth token before calling edge function
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
        setIsQuerying(false); return;
      }
      const currentSessionId = activeConversationId;
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: { question: text.trim(), documentType: filtersAtSendTime.docType || undefined, uploadDate: filtersAtSendTime.uploadDate || undefined, filterSite: filtersAtSendTime.site || undefined, equipmentType: filtersAtSendTime.equipmentType || undefined, equipmentMake: filtersAtSendTime.equipmentMake || undefined, equipmentModel: filtersAtSendTime.equipmentModel || undefined, isConversationMode: false, projectId: projectId || undefined, sessionId: currentSessionId || undefined, documentIds: filtersAtSendTime.documentIds?.length ? filtersAtSendTime.documentIds : undefined, dynamicMetadata: Object.keys(filtersAtSendTime.dynamicMetadata || {}).length ? filtersAtSendTime.dynamicMetadata : undefined, accessRole: filtersAtSendTime.accessRole || undefined, model: selectedModel }
      });
      if (error) throw error;
      const assistantMessage: ChatMessage = { id: `assistant-${Date.now()}`, role: "assistant", content: data.answer, timestamp: new Date(), sources: data.sources || [] };
      addMessage(assistantMessage);
    } catch (error: any) {
      console.error("Error querying assistant:", error);
      toast({ title: "Error querying assistant", description: error.message || "An unexpected error occurred.", variant: "destructive" });
    } finally {setIsQuerying(false);setFiltersLocked(false);}
  }, [hasDocuments, chatHistory, addMessage, stopListening, toast]);

  const startDictation = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({ title: "Speech recognition not supported", description: "Your browser doesn't support speech recognition.", variant: "destructive" });
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    dictationActiveRef.current = true;
    let finalTranscript = '';
    recognition.onstart = () => {setIsDictating(true); abortCountRef.current = 0;};
    recognition.onresult = (event: any) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimText += transcript;
        }
      }
      setQuestion((finalTranscript + interimText).trim());
    };
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        toast({ title: "Microphone permission denied", description: "Please enable mic access in your browser.", variant: "destructive" });
        dictationActiveRef.current = false; setIsDictating(false); recognitionRef.current = null; return;
      }
      if (event.error === 'no-speech' && dictationActiveRef.current) {
        recognitionRef.current = null;
        setTimeout(() => { if (dictationActiveRef.current) startDictation(); }, 300);
        return;
      }
      if (event.error === 'aborted') {
        recognitionRef.current = null;
        abortCountRef.current++;
        if (abortCountRef.current >= 3) {
          dictationActiveRef.current = false; setIsDictating(false);
          toast({ title: "Voice not available", description: "Speech recognition is not available in this environment. Try a different browser.", variant: "destructive" });
        }
        return;
      }
      toast({ title: "Speech recognition error", description: event.error, variant: "destructive" });
      dictationActiveRef.current = false; setIsDictating(false); recognitionRef.current = null;
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!dictationActiveRef.current) { setIsDictating(false); return; }
      setTimeout(() => { if (dictationActiveRef.current) startDictation(); }, 200);
    };
    recognition.start();
  }, [toast]);

  const handleDictateToggle = () => {if (isDictating) {stopListening();} else {dictationPartsRef.current = []; startDictation();}};

  const stopConversationSpeaking = useCallback(() => {
    // Stop TTS but stay in conversation mode — restart listening
    if (ttsKeepAliveRef.current) { clearInterval(ttsKeepAliveRef.current); ttsKeepAliveRef.current = null; }
    if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); utteranceQueueRef.current++; }
    setIsSpeaking(false);
    setIsQuerying(false);
    setFiltersLocked(false);
    // Clean up any existing recognition before restarting
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) {}
      recognitionRef.current = null;
    }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (listeningWatchdogRef.current) { clearTimeout(listeningWatchdogRef.current); listeningWatchdogRef.current = null; }
    isProcessingVoiceRef.current = false;
    lastSubmittedTranscriptRef.current = "";
    recognitionStartedRef.current = false;
    if (conversationActiveRef.current) {
      setConversationState("listening");
      setQuestion("");
      // Use longer initial delay to let browser fully release mic after TTS cancel
      setTimeout(() => {
        if (conversationActiveRef.current) {
          startConversationListening();
        }
      }, 800);
    }
  }, [startConversationListening]);

  const handleConversationToggle = () => {
    if (isConversationMode) {
      conversationActiveRef.current = false;
      isProcessingVoiceRef.current = false;
      lastSubmittedTranscriptRef.current = "";
      stopListening();
      stopSpeaking();
      setIsConversationMode(false);
      setConversationState("idle");
      setQuestion("");
    } else {
      ensureActiveConversation();
      conversationActiveRef.current = true;
      setIsConversationMode(true);
      setQuestion("");
      setTimeout(() => {startConversationListening();}, 100);
    }
  };

  const handleSend = () => {if (question.trim()) {sendMessage(question, isDictating ? "dictation" : "text");}};

  const handleFilterChange = (key: keyof ConversationFilters, value: string | undefined) => {
    updateCurrentFilters({ ...currentFilters, [key]: value === "__all__" ? "" : value });
  };

  const handleDynamicMetadataChange = (field: string, value: string) => {
    const newFilters = {
      ...currentFilters,
      dynamicMetadata: { ...currentFilters.dynamicMetadata, [field]: value || "" }
    };
    updateCurrentFilters(newFilters);
  };

  const hasText = question.trim().length > 0;
  const showSendButton = hasText && !isConversationMode;
  const showConversationButton = !hasText && !isConversationMode && !isDictating;

  const getUserLabel = (msg: ChatMessage) => {
    if (msg.inputMode === "voice") return "You (voice)";
    if (msg.inputMode === "dictation") return "You (dictation)";
    return "You";
  };

  // Compute active filters from dynamic metadata + defaults
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  Object.entries(currentFilters.dynamicMetadata || {}).forEach(([field, value]) => {
    if (value) activeFilters.push({ key: `meta_${field}`, label: `${field}: ${value}`, clear: () => handleDynamicMetadataChange(field, "") });
  });
  if (currentFilters.accessRole) activeFilters.push({ key: 'accessRole', label: `Role: ${currentFilters.accessRole}`, clear: () => updateCurrentFilters({ ...currentFilters, accessRole: "" }) });
  if (currentFilters.documentIds.length > 0) {
    const docLabel = currentFilters.documentIds.length === 1 ? (projectDocuments.find(d => d.id === currentFilters.documentIds[0])?.name || '1 document') : `${currentFilters.documentIds.length} documents`;
    activeFilters.push({ key: 'documents', label: `Documents: ${docLabel}`, clear: () => updateCurrentFilters({ ...currentFilters, documentIds: [] }) });
  }

  // Grid cols for filter modal
  const filterFieldCount = projectFields.length + 2; // +1 Access Role, +1 Documents
  const filterGridCols = filterFieldCount <= 2 ? 2 : 3;

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* ── SIDEBAR ─────────────────────────────────────────────────── */}
      {sidebarOpen &&
      <>
        {/* Mobile overlay backdrop */}
        {isMobileDevice && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.4)',
              zIndex: 29,
            }}
          />
        )}
        <div
        style={{
          width: '260px',
          flexShrink: 0,
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'hsl(var(--sidebar-background))',
          borderRight: '1px solid hsl(var(--sidebar-border))',
          ...(isMobileDevice ? {
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 30,
          } : {}),
        }}>

          {/* Project selector dropdown */}
          {projects && currentProject && onProjectSwitch && (
            <div className="flex-shrink-0 px-4 pt-3 pb-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors text-sm font-medium text-foreground">
                    <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{currentProject.name}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56 bg-popover border border-border shadow-lg z-50">
                  {projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => onProjectSwitch(project)}
                      className="flex items-center gap-2"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 text-left truncate">{project.name}</span>
                      {project.id === currentProject.id && (
                        <Check className="h-4 w-4 text-foreground flex-shrink-0 ml-auto" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Conversation list — self-contained scroll, never scrolls the page */}
          <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onNewConversation={startNewConversation}
          onSelectConversation={switchConversation}
          onDeleteConversation={deleteConversation}
          onRenameConversation={renameConversation}
          onReorderConversations={reorderConversations}
          canDelete={canDelete} />

        </div>
      </>
      }

      {/* Sidebar toggle — always floats outside the sidebar */}
      <div
        style={{
          position: 'absolute',
          top: '14px',
          left: sidebarOpen ? '268px' : '14px',
          transition: 'left 0.2s',
          zIndex: 31
        }}>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setSidebarOpen((prev) => !prev)}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>

          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>
      </div>

      {/* ── MAIN CHAT AREA ──────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100%',
          overflow: 'hidden',
          position: 'relative'
        }}>

        {/* Floating tab switcher — top right, with background on mobile so text scrolls under */}
        {tabSwitcher && (
          <div className="absolute top-0 right-0 left-0 sm:left-auto z-10 flex justify-end px-4 py-3 bg-popover sm:bg-transparent pointer-events-none">
            <div className="pointer-events-auto">
              {tabSwitcher}
            </div>
          </div>
        )}

        {/* Messages wrapper with scroll-to-bottom */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <div
            ref={chatContainerRef}
            onScroll={handleChatScroll}
            style={{ height: '100%', overflowY: 'auto' }} className="bg-popover">

            {chatHistory.length === 0 && !isQuerying ?
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Start a conversation by asking a question
              </div> :

            <div className="max-w-3xl mx-auto w-full pl-10 pr-8 py-8 space-y-8">
                {chatHistory.map((msg) =>
              <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cn(msg.role === "user" ? "max-w-[75%] text-left" : "w-full text-left")}>
                      <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                        {msg.role === "user" ? getUserLabel(msg) : "Service AI"}
                      </p>
                      {msg.role === "assistant" ?
                  <div className="text-sm text-foreground">
                          <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-headings:font-semibold prose-headings:tracking-tight prose-strong:text-foreground prose-li:text-foreground prose-p:my-3 prose-p:leading-7 prose-ul:my-3 prose-li:my-1 leading-7">
                            <MarkdownWithCitations
                              content={msg.content}
                              sources={msg.sources}
                              onOpenDocument={(docId, text, fname, chunkIdx) => setDocumentViewer({ open: true, documentId: docId, highlightText: text, filename: fname, chunkIndex: chunkIdx })}
                            />
                          </div>
                          {!isConversationMode && (
                            <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => (isSpeaking && speakingMessageId === msg.id) ? stopSpeaking() : speakText(msg.content, undefined, msg.id)}
                        className="mt-1 h-7 px-2 text-xs text-muted-foreground hover:text-foreground">

                              {(isSpeaking && speakingMessageId === msg.id) ? <><VolumeX className="h-3 w-3 mr-1" />Stop</> : <><Volume2 className="h-3 w-3 mr-1" />Listen</>}
                            </Button>
                          )}
                        </div> :

                  <div className="bg-muted/70 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-foreground leading-7 inline-block">
                          {msg.content}
                        </div>
                  }
                    </div>
                  </div>
              )}
                {isQuerying &&
              <div className="flex justify-start">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5 font-medium">Service AI</p>
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /><span>Thinking...</span>
                      </div>
                    </div>
                  </div>
              }
              </div>
            }
          </div>

          {/* Scroll to bottom button */}
          {showScrollDown && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 h-8 w-8 rounded-full bg-background border border-border shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:shadow-lg transition-all"
              title="Scroll to latest"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Document Viewer Modal */}
        <DocumentViewerModal
          open={documentViewer.open}
          onClose={() => setDocumentViewer(prev => ({ ...prev, open: false }))}
          documentId={documentViewer.documentId}
          highlightText={documentViewer.highlightText}
          filename={documentViewer.filename}
          chunkIndex={documentViewer.chunkIndex}
        />

        {/* Input area — always sticks to bottom */}
        <div className="py-5 flex-shrink-0 bg-popover">
          {!canWrite ?
          <div className="text-center py-4 text-muted-foreground text-sm">You have read-only access.</div> :

          <div className="max-w-3xl mx-auto pl-10 pr-8">
              <div className="relative rounded-2xl border border-border/60 bg-background shadow-sm focus-within:shadow-md focus-within:border-border transition-all overflow-hidden">
                {activeFilters.length > 0 &&
              <div className="flex flex-wrap gap-1.5 px-4 pt-3">
                    {activeFilters.map(f =>
                <Badge key={f.key} variant="secondary" className="text-xs gap-1 h-5 px-2 bg-primary/10 text-primary hover:bg-primary/20">
                        {f.label}
                        <X className="h-3 w-3 cursor-pointer" onClick={f.clear} />
                      </Badge>
                )}
                  </div>
              }
                <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                isConversationMode ?
                conversationState === "listening" ? "Listening..." : conversationState === "processing" ? "Processing..." : conversationState === "speaking" ? "Speaking..." : isSpeaking ? "Speaking..." : "Listening..." :
                "Ask a question..."
                }
                rows={3}
                disabled={isQuerying || isConversationMode}
                onKeyDown={(e) => {if (e.key === 'Enter' && !e.shiftKey && !isConversationMode && hasText) {e.preventDefault();handleSend();}}}
                className="resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent pt-3 pb-10 px-4 text-sm leading-relaxed" />

                <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {hasDocuments &&
                  <Button
                    onClick={() => setFiltersModalOpen(true)}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground gap-1.5 rounded-lg hover:text-foreground">

                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        Filters{activeFilters.length > 0 && ` (${activeFilters.length})`}
                      </Button>
                  }
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1.5 rounded-lg hover:text-foreground">
                          <span className="hidden sm:inline">{selectedModel === "google/gemini-2.5-flash-lite" ? "Flash Lite" : "Gemini 3 Flash"}</span>
                          <span className="sm:hidden">{selectedModel === "google/gemini-2.5-flash-lite" ? "Lite" : "G3"}</span>
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56 bg-popover border border-border shadow-lg z-50">
                        <DropdownMenuItem onClick={() => setSelectedModel("google/gemini-2.5-flash-lite")} className="flex items-center gap-2 text-sm">
                          {selectedModel === "google/gemini-2.5-flash-lite" && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
                          <span className={selectedModel !== "google/gemini-2.5-flash-lite" ? "ml-5" : ""}>Gemini 2.5 Flash Lite (default)</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedModel("google/gemini-3-flash-preview")} className="flex items-center gap-2 text-sm">
                          {selectedModel === "google/gemini-3-flash-preview" && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
                          <span className={selectedModel !== "google/gemini-3-flash-preview" ? "ml-5" : ""}>Gemini 3 Flash</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-center gap-1">
                    {isConversationMode ?
                  <>
                        {(conversationState === "speaking" || isSpeaking) && (
                          <Button onClick={stopConversationSpeaking} variant="outline" size="icon" className="h-8 w-8 rounded-lg" title="Skip speech">
                            <VolumeX className="h-4 w-4" />
                          </Button>
                        )}
                        <Button onClick={handleConversationToggle} variant="destructive" size="icon" className="h-8 w-8 rounded-lg" title="End conversation">
                          <Square className="h-4 w-4" />
                        </Button>
                      </> :

                  <>
                        <Button
                      onClick={handleDictateToggle}
                      disabled={isQuerying || !hasDocuments}
                      variant={isDictating ? "destructive" : "ghost"}
                      size="icon"
                      className={cn("h-8 w-8 rounded-lg", isDictating && "animate-pulse")}
                      title={isDictating ? "Stop" : "Dictate"}>

                          <Mic className="h-4 w-4" />
                        </Button>
                        {showConversationButton &&
                    <Button onClick={handleConversationToggle} disabled={isQuerying || !hasDocuments} variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                            <AudioWaveform className="h-4 w-4" />
                          </Button>
                    }
                        {showSendButton &&
                    <Button
                      onClick={handleSend}
                      disabled={isQuerying || !hasDocuments || !hasText}
                      size="icon"
                      className="h-8 w-8 rounded-lg bg-brand text-brand-foreground hover:bg-brand-hover">

                            {isQuerying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          </Button>
                    }
                      </>
                  }
                  </div>
                </div>
              </div>
              {!hasDocuments &&
            <p className="text-xs text-muted-foreground text-center mt-2">Upload documents to start querying</p>
            }
            </div>
          }
        </div>

        {/* Filters Modal — mirrors Repository filter panel */}
        <Dialog open={filtersModalOpen} onOpenChange={setFiltersModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Query Filters</DialogTitle>
              <DialogDescription>Scope retrieval to specific documents.</DialogDescription>
            </DialogHeader>
            <div className={`grid gap-x-6 gap-y-4 py-3 ${filterGridCols === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {/* Dynamic project metadata fields */}
              {projectFields.map(field => {
                const value = currentFilters.dynamicMetadata[field] || "";
                const options = fieldOptions[field] || [];
                return (
                  <div key={field}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{field}</p>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="w-full flex items-center justify-between h-10 border border-border rounded-lg px-3 text-sm bg-background hover:bg-muted/40 transition-colors text-left" disabled={filtersLocked}>
                          <span className={value ? "text-foreground" : "text-muted-foreground"}>{value || "All"}</span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-0 z-50 bg-background border border-border shadow-lg" align="start">
                        <Command>
                          <CommandList>
                            <CommandGroup>
                              <CommandItem onSelect={() => handleDynamicMetadataChange(field, "")} className="text-sm">
                                <Check className={cn("mr-2 h-3.5 w-3.5", !value ? "opacity-100" : "opacity-0")} />
                                All
                              </CommandItem>
                              {options.map(opt => (
                                <CommandItem key={opt} onSelect={() => handleDynamicMetadataChange(field, opt)} className="text-sm">
                                  <Check className={cn("mr-2 h-3.5 w-3.5", value === opt ? "opacity-100" : "opacity-0")} />
                                  {opt}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                );
              })}

              {/* Default: Access Role */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Access Role</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="w-full flex items-center justify-between h-10 border border-border rounded-lg px-3 text-sm bg-background hover:bg-muted/40 transition-colors text-left" disabled={filtersLocked}>
                      <span className={currentFilters.accessRole ? "text-foreground" : "text-muted-foreground"}>{currentFilters.accessRole || "All"}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-0 z-50 bg-background border border-border shadow-lg" align="start">
                    <Command>
                      <CommandList>
                        <CommandGroup>
                          <CommandItem onSelect={() => updateCurrentFilters({ ...currentFilters, accessRole: "" })} className="text-sm">
                            <Check className={cn("mr-2 h-3.5 w-3.5", !currentFilters.accessRole ? "opacity-100" : "opacity-0")} />
                            All
                          </CommandItem>
                          {availableRoles.map(role => (
                            <CommandItem key={role.role} onSelect={() => updateCurrentFilters({ ...currentFilters, accessRole: role.role })} className="text-sm">
                              <Check className={cn("mr-2 h-3.5 w-3.5", currentFilters.accessRole === role.role ? "opacity-100" : "opacity-0")} />
                              {role.displayName || role.role}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Default: Documents multi-select */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Documents</p>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="w-full flex items-center justify-between h-10 border border-border rounded-lg px-3 text-sm bg-background hover:bg-muted/40 transition-colors text-left" disabled={filtersLocked}>
                      <span className="text-foreground truncate">
                        {currentFilters.documentIds.length === 0 ? "All" :
                         currentFilters.documentIds.length === 1 ? (projectDocuments.find(d => d.id === currentFilters.documentIds[0])?.name || "1 document") :
                         `${currentFilters.documentIds.length} documents`}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0 z-50 bg-background border border-border shadow-lg" align="start">
                    <Command>
                      <CommandInput placeholder="Search documents..." />
                      <CommandList>
                        <CommandEmpty>No documents found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem onSelect={() => updateCurrentFilters({ ...currentFilters, documentIds: [] })} className="text-sm">
                            <Check className={cn("mr-2 h-3.5 w-3.5", currentFilters.documentIds.length === 0 ? "opacity-100" : "opacity-0")} />
                            All Documents
                          </CommandItem>
                          <Separator className="my-1" />
                          {projectDocuments.map(doc => {
                            const isSelected = currentFilters.documentIds.includes(doc.id) || currentFilters.documentIds.length === 0;
                            return (
                              <CommandItem key={doc.id} onSelect={() => {
                                const ids = currentFilters.documentIds;
                                let next: string[];
                                if (ids.includes(doc.id)) {
                                  next = ids.filter(i => i !== doc.id);
                                } else {
                                  next = [...ids, doc.id];
                                }
                                if (next.length === projectDocuments.length) next = [];
                                updateCurrentFilters({ ...currentFilters, documentIds: next });
                              }} className="text-sm">
                                <Check className={cn("mr-2 h-3.5 w-3.5", isSelected ? "opacity-100" : "opacity-0")} />
                                <span className="truncate">{doc.name}</span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateCurrentFilters({ docType: "", uploadDate: undefined, site: "", equipmentType: "", equipmentMake: "", equipmentModel: "", documentIds: [], dynamicMetadata: {}, accessRole: "" })}>
                Reset
              </Button>
              <Button onClick={() => setFiltersModalOpen(false)} className="bg-brand text-brand-foreground hover:bg-brand-hover">Apply</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>);

};