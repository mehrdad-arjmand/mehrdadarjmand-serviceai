import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, Mic, Loader2, Volume2, VolumeX, AudioWaveform, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";
import { renderAnswerForSpeech, selectBestVoice, createUtterance, splitIntoSentences } from "@/lib/ttsUtils";
import { useChatHistory, ChatMessage, ConversationFilters } from "@/hooks/useChatHistory";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";

import { TabPermissions } from "@/hooks/usePermissions";

interface TechnicianChatProps {
  hasDocuments: boolean;
  chunksCount: number;
  permissions: TabPermissions;
}

interface Source {
  filename: string;
  chunkIndex: number;
  text: string;
  similarity: number;
}

export const TechnicianChat = ({ hasDocuments, chunksCount, permissions }: TechnicianChatProps) => {
  const canWrite = permissions.write;
  const canDelete = permissions.delete;
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { toast } = useToast();

  // Use persistent chat history hook
  const {
    messages: chatHistory,
    conversations,
    activeConversationId,
    addMessage,
    startNewConversation,
    deleteConversation,
    switchConversation,
    ensureActiveConversation,
    renameConversation,
    reorderConversations,
  } = useChatHistory();

  // LOCAL filter state - these are dynamic and read at send time
  const [currentFilters, setCurrentFilters] = useState<ConversationFilters>({
    docType: "",
    uploadDate: undefined,
    site: "",
    equipmentType: "",
    equipmentMake: "",
    equipmentModel: "",
  });

  // Lock filters while a request is in flight
  const [filtersLocked, setFiltersLocked] = useState(false);

  // Ensure we have an active conversation on mount
  useEffect(() => {
    ensureActiveConversation();
  }, [ensureActiveConversation]);

  // Conversation mode state
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [conversationState, setConversationState] = useState<"idle" | "listening" | "processing" | "speaking">("idle");

  // Dictation mode state (separate from conversation)
  const [isDictating, setIsDictating] = useState(false);

  // Silence detection threshold in milliseconds
  const SILENCE_THRESHOLD_MS = 1200;

  // Refs
  const recognitionRef = useRef<any>(null);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceQueueRef = useRef<number>(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const conversationActiveRef = useRef(false);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentTranscriptRef = useRef<string>("");
  // Ref for filters to ensure voice mode always reads the latest values
  const currentFiltersRef = useRef<ConversationFilters>(currentFilters);

  // Keep the ref in sync with state
  useEffect(() => {
    currentFiltersRef.current = currentFilters;
  }, [currentFilters]);

  // Filter options (populated from documents)
  const [docTypes, setDocTypes] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>([]);
  const [equipmentMakes, setEquipmentMakes] = useState<string[]>([]);
  const [equipmentModels, setEquipmentModels] = useState<string[]>([]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // Initialize voice and cleanup on unmount
  useEffect(() => {
    const initVoice = () => {
      selectedVoiceRef.current = selectBestVoice();
    };
    initVoice();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = initVoice;
    }
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      stopListening();
      stopSpeaking();
    };
  }, []);

  // Fetch filter options
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const { data: documents } = await supabase
          .from('documents')
          .select('doc_type, site, equipment_make, equipment_model');

        const { data: chunks } = await supabase
          .from('chunks')
          .select('equipment')
          .not('equipment', 'is', null);

        if (documents) {
          setDocTypes([...new Set(documents.map(d => d.doc_type).filter(Boolean))] as string[]);
          setSites([...new Set(documents.map(d => d.site).filter(Boolean))] as string[]);
          setEquipmentMakes([...new Set(documents.map(d => d.equipment_make).filter(Boolean))] as string[]);
          setEquipmentModels([...new Set(documents.map(d => d.equipment_model).filter(Boolean))] as string[]);
        }

        if (chunks) {
          setEquipmentTypes([...new Set(chunks.map(c => c.equipment).filter(Boolean))] as string[]);
        }
      } catch (error) {
        console.error('Error fetching filter options:', error);
      }
    };

    if (hasDocuments) {
      fetchFilterOptions();
    }
  }, [hasDocuments]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore errors from stopping
      }
      recognitionRef.current = null;
    }
    setIsDictating(false);
    currentTranscriptRef.current = '';
  }, []);

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      utteranceQueueRef.current++;
    }
    setIsSpeaking(false);
    setConversationState(prev => prev === "speaking" ? "idle" : prev);
  }, []);

  // Speak text with TTS
  const speakText = useCallback((text: string, onComplete?: () => void) => {
    if (!('speechSynthesis' in window)) {
      toast({
        title: "TTS not supported",
        description: "Voice playback is not supported in this browser.",
        variant: "destructive",
      });
      onComplete?.();
      return;
    }

    window.speechSynthesis.cancel();
    
    const cleanText = renderAnswerForSpeech(text);
    const sentences = splitIntoSentences(cleanText);
    
    if (sentences.length === 0) {
      onComplete?.();
      return;
    }
    
    if (!selectedVoiceRef.current) {
      selectedVoiceRef.current = selectBestVoice();
    }

    const queueId = ++utteranceQueueRef.current;
    let currentIndex = 0;
    
    setIsSpeaking(true);
    
    const speakNext = () => {
      if (queueId !== utteranceQueueRef.current) return;
      
      if (currentIndex >= sentences.length) {
        setIsSpeaking(false);
        onComplete?.();
        return;
      }
      
      const utterance = createUtterance(sentences[currentIndex], selectedVoiceRef.current);
      
      utterance.onend = () => {
        currentIndex++;
        speakNext();
      };
      
      utterance.onerror = () => {
        setIsSpeaking(false);
        onComplete?.();
      };
      
      window.speechSynthesis.speak(utterance);
    };
    
    speakNext();
  }, [toast]);

  // Clear any pending silence timer
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Start listening for conversation mode - with silence detection
  const startConversationListening = useCallback(() => {
    if (!conversationActiveRef.current) return;
    
    clearSilenceTimer();
    
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({
        title: "Speech recognition not supported",
        description: "Your browser doesn't support speech recognition.",
        variant: "destructive",
      });
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    currentTranscriptRef.current = '';

    recognition.onstart = () => {
      setConversationState("listening");
      setQuestion("");
      currentTranscriptRef.current = '';
    };

    recognition.onresult = (event: any) => {
      clearSilenceTimer();
      
      let fullTranscript = '';
      
      for (let i = 0; i < event.results.length; i++) {
        fullTranscript += event.results[i][0].transcript;
      }
      
      currentTranscriptRef.current = fullTranscript;
      setQuestion(fullTranscript);
      
      silenceTimerRef.current = setTimeout(() => {
        const transcript = currentTranscriptRef.current.trim();
        
        if (transcript && conversationActiveRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (e) {
            // Ignore stop errors
          }
          recognitionRef.current = null;
          
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
        toast({
          title: "Microphone permission denied",
          description: "Please enable mic access in your browser.",
          variant: "destructive",
        });
        conversationActiveRef.current = false;
        setIsConversationMode(false);
        setConversationState("idle");
      } else if (event.error === 'no-speech' && conversationActiveRef.current) {
        recognitionRef.current = null;
        setTimeout(() => {
          if (conversationActiveRef.current) {
            startConversationListening();
          }
        }, 300);
      } else if (event.error !== 'aborted' && conversationActiveRef.current) {
        recognitionRef.current = null;
        setTimeout(() => {
          if (conversationActiveRef.current) {
            startConversationListening();
          }
        }, 500);
      } else {
        recognitionRef.current = null;
      }
    };

    recognition.onend = () => {
      const hadTranscript = currentTranscriptRef.current.trim().length > 0;
      recognitionRef.current = null;
      
      if (conversationActiveRef.current && conversationState === "listening" && !hadTranscript) {
        setTimeout(() => {
          if (conversationActiveRef.current) {
            startConversationListening();
          }
        }, 300);
      }
    };

    recognition.start();
  }, [toast, clearSilenceTimer, conversationState]);

  // Process a conversation message (voice mode)
  const processConversationMessage = useCallback(async (text: string) => {
    if (!hasDocuments) {
      toast({
        title: "No documents indexed",
        description: "Please upload and index documents first.",
        variant: "destructive",
      });
      return;
    }

    // Read current filters at send time from REF (ensures latest value, not stale closure)
    const filtersAtSendTime = { ...currentFiltersRef.current };
    console.log("Voice query filters at send time:", filtersAtSendTime);
    setFiltersLocked(true);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text.trim(),
      inputMode: "voice",
      timestamp: new Date(),
    };
    
    addMessage(userMessage);
    setIsQuerying(true);
    setSources([]);

    const recentHistory = chatHistory.slice(-8).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: {
          question: text.trim(),
          documentType: filtersAtSendTime.docType || undefined,
          uploadDate: filtersAtSendTime.uploadDate || undefined,
          filterSite: filtersAtSendTime.site || undefined,
          equipmentType: filtersAtSendTime.equipmentType || undefined,
          equipmentMake: filtersAtSendTime.equipmentMake || undefined,
          equipmentModel: filtersAtSendTime.equipmentModel || undefined,
          history: recentHistory,
          isConversationMode: true,
        },
      });

      if (error) throw error;

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        inputMode: "voice",
        timestamp: new Date(),
      };
      
      addMessage(assistantMessage);
      setSources(data.sources || []);

      if (data.answer && conversationActiveRef.current) {
        setConversationState("speaking");
        speakText(data.answer, () => {
          setFiltersLocked(false);
          if (conversationActiveRef.current) {
            setTimeout(() => {
              if (conversationActiveRef.current) {
                startConversationListening();
              }
            }, 300);
          }
        });
      } else {
        setFiltersLocked(false);
      }

    } catch (error: any) {
      console.error("Error querying assistant:", error);
      toast({
        title: "Error querying assistant",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      setFiltersLocked(false);
      
      if (conversationActiveRef.current) {
        setConversationState("idle");
        setTimeout(() => {
          if (conversationActiveRef.current) {
            startConversationListening();
          }
        }, 1000);
      }
    } finally {
      setIsQuerying(false);
    }
  }, [hasDocuments, chatHistory, addMessage, speakText, startConversationListening, toast]);

  // Send text message to API
  const sendMessage = useCallback(async (
    text: string,
    inputMode: "text" | "dictation"
  ) => {
    // CRITICAL: Stop dictation before sending to prevent TTS from being transcribed
    stopListening();
    
    if (!hasDocuments) {
      toast({
        title: "No documents indexed",
        description: "Please upload and index documents first.",
        variant: "destructive",
      });
      return;
    }

    if (!text.trim()) return;

    // Read current filters at send time from REF (ensures latest value, not stale closure)
    const filtersAtSendTime = { ...currentFiltersRef.current };
    console.log("Text query filters at send time:", filtersAtSendTime);
    setFiltersLocked(true);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text.trim(),
      inputMode,
      timestamp: new Date(),
    };
    
    addMessage(userMessage);
    setQuestion("");
    setIsQuerying(true);
    setSources([]);

    const recentHistory = chatHistory.slice(-8).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: {
          question: text.trim(),
          documentType: filtersAtSendTime.docType || undefined,
          uploadDate: filtersAtSendTime.uploadDate || undefined,
          filterSite: filtersAtSendTime.site || undefined,
          equipmentType: filtersAtSendTime.equipmentType || undefined,
          equipmentMake: filtersAtSendTime.equipmentMake || undefined,
          equipmentModel: filtersAtSendTime.equipmentModel || undefined,
          history: recentHistory,
          isConversationMode: false,
        },
      });

      if (error) throw error;

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        timestamp: new Date(),
      };
      
      addMessage(assistantMessage);
      setSources(data.sources || []);

      toast({
        title: "Answer generated",
        description: `Found ${data.sources?.length || 0} relevant sources.`,
      });
    } catch (error: any) {
      console.error("Error querying assistant:", error);
      toast({
        title: "Error querying assistant",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsQuerying(false);
      setFiltersLocked(false);
    }
  }, [hasDocuments, chatHistory, addMessage, stopListening, toast]);

  // Start dictation (one-shot, user reviews and sends)
  const startDictation = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({
        title: "Speech recognition not supported",
        description: "Your browser doesn't support speech recognition.",
        variant: "destructive",
      });
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onstart = () => {
      setIsDictating(true);
    };

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }
      
      setQuestion(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      
      if (event.error === 'not-allowed') {
        toast({
          title: "Microphone permission denied",
          description: "Please enable mic access in your browser.",
          variant: "destructive",
        });
      } else if (event.error !== 'aborted') {
        toast({
          title: "Speech recognition error",
          description: event.error,
          variant: "destructive",
        });
      }
      
      setIsDictating(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsDictating(false);
      recognitionRef.current = null;
    };

    recognition.start();
  }, [toast]);

  // Handle dictation button click
  const handleDictateToggle = () => {
    if (isDictating) {
      stopListening();
    } else {
      startDictation();
    }
  };

  // Handle conversation mode toggle
  const handleConversationToggle = () => {
    if (isConversationMode) {
      conversationActiveRef.current = false;
      stopListening();
      stopSpeaking();
      setIsConversationMode(false);
      setConversationState("idle");
      setQuestion("");
    } else {
      // CRITICAL: Ensure we have an active conversation BEFORE starting voice mode
      // This prevents the cold-start issue where voice messages aren't logged
      ensureActiveConversation();
      
      conversationActiveRef.current = true;
      setIsConversationMode(true);
      setQuestion("");
      setTimeout(() => {
        startConversationListening();
      }, 100);
    }
  };

  // Handle send button
  const handleSend = () => {
    if (question.trim()) {
      sendMessage(question, isDictating ? "dictation" : "text");
    }
  };

  // Handle filter changes - update local state (dynamic per question)
  const handleFilterChange = (key: keyof ConversationFilters, value: string | undefined) => {
    setCurrentFilters(prev => ({
      ...prev,
      [key]: value === "__all__" ? "" : value
    }));
  };

  // Determine which buttons to show
  const hasText = question.trim().length > 0;
  const showSendButton = hasText && !isConversationMode;
  const showConversationButton = !hasText && !isConversationMode && !isDictating;

  // Get user label based on input mode
  const getUserLabel = (msg: ChatMessage) => {
    if (msg.inputMode === "voice") return "You (voice)";
    if (msg.inputMode === "dictation") return "You (dictation)";
    return "You";
  };

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[500px] border border-border/50 rounded-2xl overflow-hidden bg-card shadow-premium">
      {/* Left sidebar - Conversation list */}
      <div className="w-72 flex-shrink-0 hidden md:block">
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onNewConversation={startNewConversation}
          onSelectConversation={switchConversation}
          onDeleteConversation={deleteConversation}
          onRenameConversation={renameConversation}
          onReorderConversations={reorderConversations}
          canDelete={canDelete}
        />
      </div>

      {/* Main chat panel */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border/50 bg-card flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground tracking-tight">
                Technician Assistant
              </h2>
              <p className="text-sm text-muted-foreground font-normal mt-0.5">
                Ask questions about your equipment and procedures
              </p>
            </div>
            {/* Mobile: New conversation button */}
            <Button
              variant="outline"
              size="sm"
              onClick={startNewConversation}
              className="h-9 md:hidden rounded-lg"
              title="Start new conversation"
            >
              New
            </Button>
          </div>
        </div>

        {/* Filters Section */}
        {hasDocuments && (
          <div className="px-6 py-4 border-b border-border/50 bg-muted/20 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <Label className="text-sm font-medium">Optional Filters</Label>
              <span className="text-xs text-muted-foreground font-normal">Leave empty to search all documents</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Document Type */}
              <div className="space-y-1.5">
                <Label htmlFor="filter-doc-type" className="text-xs">Document Type</Label>
                <Select 
                  value={currentFilters.docType || "__all__"} 
                  onValueChange={(v) => handleFilterChange("docType", v)}
                  disabled={filtersLocked}
                >
                  <SelectTrigger id="filter-doc-type" className="h-9">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All types</SelectItem>
                    {docTypes.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Upload Date */}
              <div className="space-y-1.5">
                <Label htmlFor="filter-upload-date" className="text-xs">Upload Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="filter-upload-date"
                      variant="outline"
                      disabled={filtersLocked}
                      className={cn(
                        "h-9 w-full justify-between text-left font-normal",
                        !currentFilters.uploadDate && "text-muted-foreground"
                      )}
                    >
                      {currentFilters.uploadDate 
                        ? format(parse(currentFilters.uploadDate, 'yyyy-MM-dd', new Date()), "PPP") 
                        : "Any date"}
                      <CalendarIcon className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={currentFilters.uploadDate 
                        ? parse(currentFilters.uploadDate, 'yyyy-MM-dd', new Date()) 
                        : undefined}
                      onSelect={(date) => handleFilterChange("uploadDate", date ? format(date, 'yyyy-MM-dd') : undefined)}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Site */}
              <div className="space-y-1.5">
                <Label htmlFor="filter-site" className="text-xs">Site</Label>
                <Select 
                  value={currentFilters.site || "__all__"} 
                  onValueChange={(v) => handleFilterChange("site", v)}
                  disabled={filtersLocked}
                >
                  <SelectTrigger id="filter-site" className="h-9">
                    <SelectValue placeholder="All sites" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All sites</SelectItem>
                    {sites.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Equipment Type */}
              <div className="space-y-1.5">
                <Label htmlFor="filter-equipment-type" className="text-xs">Equipment Type</Label>
                <Select 
                  value={currentFilters.equipmentType || "__all__"} 
                  onValueChange={(v) => handleFilterChange("equipmentType", v)}
                  disabled={filtersLocked}
                >
                  <SelectTrigger id="filter-equipment-type" className="h-9">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All types</SelectItem>
                    {equipmentTypes.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Equipment Make */}
              <div className="space-y-1.5">
                <Label htmlFor="filter-equipment-make" className="text-xs">Equipment Make</Label>
                <Select 
                  value={currentFilters.equipmentMake || "__all__"} 
                  onValueChange={(v) => handleFilterChange("equipmentMake", v)}
                  disabled={filtersLocked}
                >
                  <SelectTrigger id="filter-equipment-make" className="h-9">
                    <SelectValue placeholder="All makes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All makes</SelectItem>
                    {equipmentMakes.map((make) => (
                      <SelectItem key={make} value={make}>{make}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Equipment Model */}
              <div className="space-y-1.5">
                <Label htmlFor="filter-equipment-model" className="text-xs">Equipment Model</Label>
                <Select 
                  value={currentFilters.equipmentModel || "__all__"} 
                  onValueChange={(v) => handleFilterChange("equipmentModel", v)}
                  disabled={filtersLocked}
                >
                  <SelectTrigger id="filter-equipment-model" className="h-9">
                    <SelectValue placeholder="All models" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All models</SelectItem>
                    {equipmentModels.map((model) => (
                      <SelectItem key={model} value={model}>{model}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Scrollable chat + sources area with fixed proportions */}
        <div className="flex-1 overflow-hidden flex flex-col p-6 min-h-0">
          {/* Chat History - guaranteed minimum height */}
          <div 
            ref={chatContainerRef}
            className="flex-1 min-h-[200px] overflow-y-auto space-y-4 p-4 bg-muted/10 rounded-xl border border-border/30"
          >
            {chatHistory.length === 0 && !isQuerying ? (
              <div className="flex-1 flex items-center justify-center h-full text-muted-foreground text-sm">
                Start a conversation by typing or speaking a question
              </div>
            ) : (
              <>
                {chatHistory.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "p-4 rounded-xl text-sm transition-all duration-200",
                      msg.role === "user" 
                        ? "bg-primary/5 ml-12 border border-primary/10" 
                        : "bg-card mr-12 shadow-sm border border-border/30"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground font-medium">
                        {msg.role === "user" ? getUserLabel(msg) : "Service AI"}
                      </span>
                      {msg.role === "assistant" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => isSpeaking ? stopSpeaking() : speakText(msg.content)}
                          className="h-7 px-2.5 text-xs rounded-lg hover:bg-muted transition-colors"
                        >
                          {isSpeaking ? (
                            <>
                              <VolumeX className="h-3.5 w-3.5 mr-1.5" />
                              Stop
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-3.5 w-3.5 mr-1.5" />
                              Listen
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-p:my-1.5 prose-p:leading-relaxed">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <span className="text-foreground leading-relaxed">{msg.content}</span>
                    )}
                  </div>
                ))}
                
                {/* Loading indicator */}
                {isQuerying && (
                  <div className="p-4 rounded-xl text-sm bg-card mr-12 shadow-sm border border-border/30">
                    <span className="text-xs text-muted-foreground font-medium block mb-2">Service AI</span>
                    <div className="flex items-center gap-2.5 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sources - constrained max height with scroll */}
          {sources.length > 0 && (
            <div className="mt-4 flex-shrink-0 max-h-[30%]">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">
                Referenced Context ({sources.length} sources)
              </h4>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {sources.map((source, idx) => (
                  <details key={idx} className="group">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors text-sm border border-border/20">
                        <span className="font-semibold text-foreground">[{idx + 1}]</span>
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {source.filename} (Chunk {source.chunkIndex})
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Similarity: {(source.similarity * 100).toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    </summary>
                    <div className="mt-2 ml-8 p-3 bg-card border border-border/30 rounded-xl text-xs text-muted-foreground max-h-24 overflow-y-auto">
                      {source.text}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Input Area - fixed at bottom */}
        <div className="px-6 py-5 border-t border-border/50 bg-card flex-shrink-0">
          {!canWrite ? (
            <div className="text-center py-4 text-muted-foreground">
              <p className="text-sm">You have read-only access to the assistant.</p>
              <p className="text-xs mt-1">Contact an administrator for write permissions.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  isConversationMode 
                    ? conversationState === "listening" 
                      ? "Listening..." 
                      : conversationState === "processing" 
                        ? "Processing..." 
                        : conversationState === "speaking" 
                          ? "Speaking..." 
                          : "Voice conversation active..."
                    : "What troubleshooting steps should I take?"
                }
                rows={3}
                disabled={isQuerying || isConversationMode}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isConversationMode && hasText) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                className="resize-none rounded-xl border-border/50 bg-muted/30 focus:bg-background transition-colors"
              />
            
            {/* Control bar */}
            <div className="flex items-center justify-between">
              {/* Left side - status */}
              <div className="text-xs text-muted-foreground font-normal">
                {!hasDocuments ? (
                  <span>Upload documents to start ({chunksCount} chunks indexed)</span>
                ) : isDictating ? (
                  <span className="text-foreground animate-pulse">Recording... Click mic to stop</span>
                ) : isConversationMode ? (
                  <span className={cn(
                    conversationState === "listening" && "text-foreground animate-pulse",
                    conversationState === "speaking" && "text-foreground"
                  )}>
                    Conversation: {conversationState === "listening" ? "Listening..." : 
                                   conversationState === "processing" ? "Thinking..." : 
                                   conversationState === "speaking" ? "Speaking..." : "Ready"}
                  </span>
                ) : null}
              </div>
              
              {/* Right side - action buttons */}
              <div className="flex items-center gap-2">
                {/* Conversation mode active: show Stop only */}
                {isConversationMode && (
                  <Button
                    onClick={handleConversationToggle}
                    variant="destructive"
                    size="icon"
                    className="h-10 w-10 rounded-xl shadow-sm"
                    title="End conversation"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                )}

                {/* Normal mode: show Mic + (Conversation OR Send) */}
                {!isConversationMode && (
                  <>
                    {/* Mic button for dictation */}
                    <Button
                      onClick={handleDictateToggle}
                      disabled={isQuerying || !hasDocuments}
                      variant={isDictating ? "destructive" : "ghost"}
                      size="icon"
                      className={cn(
                        "h-10 w-10 rounded-xl transition-all duration-200",
                        isDictating && "animate-pulse shadow-sm"
                      )}
                      title={isDictating ? "Stop recording" : "Start dictation"}
                    >
                      <Mic className="h-4 w-4" />
                    </Button>

                    {/* Show Conversation button when idle, Send button when there's text */}
                    {showConversationButton ? (
                      <Button
                        onClick={handleConversationToggle}
                        disabled={isQuerying || !hasDocuments}
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 rounded-xl transition-all duration-200"
                        title="Start voice conversation"
                      >
                        <AudioWaveform className="h-4 w-4" />
                      </Button>
                    ) : showSendButton ? (
                      <Button
                        onClick={handleSend}
                        disabled={isQuerying || !hasDocuments || !hasText}
                        size="icon"
                        className="h-10 w-10 rounded-xl bg-foreground text-background hover:bg-foreground/90 shadow-sm transition-all duration-200"
                        title="Send question"
                      >
                        {isQuerying ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
};
