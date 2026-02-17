import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, Mic, Loader2, Volume2, VolumeX, AudioWaveform, Square, ChevronDown, ChevronRight, X } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CalendarIcon } from "lucide-react";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

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

  const [currentFilters, setCurrentFilters] = useState<ConversationFilters>({
    docType: "",
    uploadDate: undefined,
    site: "",
    equipmentType: "",
    equipmentMake: "",
    equipmentModel: "",
  });

  const [filtersLocked, setFiltersLocked] = useState(false);

  useEffect(() => {
    ensureActiveConversation();
  }, [ensureActiveConversation]);

  const [isConversationMode, setIsConversationMode] = useState(false);
  const [conversationState, setConversationState] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [isDictating, setIsDictating] = useState(false);
  const SILENCE_THRESHOLD_MS = 1200;

  const recognitionRef = useRef<any>(null);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceQueueRef = useRef<number>(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const conversationActiveRef = useRef(false);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentTranscriptRef = useRef<string>("");
  const currentFiltersRef = useRef<ConversationFilters>(currentFilters);

  useEffect(() => {
    currentFiltersRef.current = currentFilters;
  }, [currentFilters]);

  const [docTypes, setDocTypes] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>([]);
  const [equipmentMakes, setEquipmentMakes] = useState<string[]>([]);
  const [equipmentModels, setEquipmentModels] = useState<string[]>([]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

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

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    setIsDictating(false);
    currentTranscriptRef.current = '';
  }, []);

  const stopSpeaking = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      utteranceQueueRef.current++;
    }
    setIsSpeaking(false);
    setConversationState(prev => prev === "speaking" ? "idle" : prev);
  }, []);

  const speakText = useCallback((text: string, onComplete?: () => void) => {
    if (!('speechSynthesis' in window)) {
      toast({ title: "TTS not supported", description: "Voice playback is not supported in this browser.", variant: "destructive" });
      onComplete?.();
      return;
    }
    window.speechSynthesis.cancel();
    const cleanText = renderAnswerForSpeech(text);
    const sentences = splitIntoSentences(cleanText);
    if (sentences.length === 0) { onComplete?.(); return; }
    if (!selectedVoiceRef.current) { selectedVoiceRef.current = selectBestVoice(); }
    const queueId = ++utteranceQueueRef.current;
    let currentIndex = 0;
    setIsSpeaking(true);
    const speakNext = () => {
      if (queueId !== utteranceQueueRef.current) return;
      if (currentIndex >= sentences.length) { setIsSpeaking(false); onComplete?.(); return; }
      const utterance = createUtterance(sentences[currentIndex], selectedVoiceRef.current);
      utterance.onend = () => { currentIndex++; speakNext(); };
      utterance.onerror = () => { setIsSpeaking(false); onComplete?.(); };
      window.speechSynthesis.speak(utterance);
    };
    speakNext();
  }, [toast]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  }, []);

  const startConversationListening = useCallback(() => {
    if (!conversationActiveRef.current) return;
    clearSilenceTimer();
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
    currentTranscriptRef.current = '';
    recognition.onstart = () => { setConversationState("listening"); setQuestion(""); currentTranscriptRef.current = ''; };
    recognition.onresult = (event: any) => {
      clearSilenceTimer();
      let fullTranscript = '';
      for (let i = 0; i < event.results.length; i++) { fullTranscript += event.results[i][0].transcript; }
      currentTranscriptRef.current = fullTranscript;
      setQuestion(fullTranscript);
      silenceTimerRef.current = setTimeout(() => {
        const transcript = currentTranscriptRef.current.trim();
        if (transcript && conversationActiveRef.current && recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch (e) {}
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
        toast({ title: "Microphone permission denied", description: "Please enable mic access in your browser.", variant: "destructive" });
        conversationActiveRef.current = false;
        setIsConversationMode(false);
        setConversationState("idle");
      } else if (event.error === 'no-speech' && conversationActiveRef.current) {
        recognitionRef.current = null;
        setTimeout(() => { if (conversationActiveRef.current) startConversationListening(); }, 300);
      } else if (event.error !== 'aborted' && conversationActiveRef.current) {
        recognitionRef.current = null;
        setTimeout(() => { if (conversationActiveRef.current) startConversationListening(); }, 500);
      } else { recognitionRef.current = null; }
    };
    recognition.onend = () => {
      const hadTranscript = currentTranscriptRef.current.trim().length > 0;
      recognitionRef.current = null;
      if (conversationActiveRef.current && conversationState === "listening" && !hadTranscript) {
        setTimeout(() => { if (conversationActiveRef.current) startConversationListening(); }, 300);
      }
    };
    recognition.start();
  }, [toast, clearSilenceTimer, conversationState]);

  const processConversationMessage = useCallback(async (text: string) => {
    if (!hasDocuments) {
      toast({ title: "No documents indexed", description: "Please upload and index documents first.", variant: "destructive" });
      return;
    }
    const filtersAtSendTime = { ...currentFiltersRef.current };
    setFiltersLocked(true);
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: text.trim(), inputMode: "voice", timestamp: new Date() };
    addMessage(userMessage);
    setIsQuerying(true);
    setSources([]);
    const recentHistory = chatHistory.slice(-8).map(msg => ({ role: msg.role, content: msg.content }));
    try {
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: { question: text.trim(), documentType: filtersAtSendTime.docType || undefined, uploadDate: filtersAtSendTime.uploadDate || undefined, filterSite: filtersAtSendTime.site || undefined, equipmentType: filtersAtSendTime.equipmentType || undefined, equipmentMake: filtersAtSendTime.equipmentMake || undefined, equipmentModel: filtersAtSendTime.equipmentModel || undefined, history: recentHistory, isConversationMode: true },
      });
      if (error) throw error;
      const assistantMessage: ChatMessage = { id: `assistant-${Date.now()}`, role: "assistant", content: data.answer, inputMode: "voice", timestamp: new Date() };
      addMessage(assistantMessage);
      setSources(data.sources || []);
      if (data.answer && conversationActiveRef.current) {
        setConversationState("speaking");
        speakText(data.answer, () => {
          setFiltersLocked(false);
          if (conversationActiveRef.current) { setTimeout(() => { if (conversationActiveRef.current) startConversationListening(); }, 300); }
        });
      } else { setFiltersLocked(false); }
    } catch (error: any) {
      console.error("Error querying assistant:", error);
      toast({ title: "Error querying assistant", description: error.message || "An unexpected error occurred.", variant: "destructive" });
      setFiltersLocked(false);
      if (conversationActiveRef.current) { setConversationState("idle"); setTimeout(() => { if (conversationActiveRef.current) startConversationListening(); }, 1000); }
    } finally { setIsQuerying(false); }
  }, [hasDocuments, chatHistory, addMessage, speakText, startConversationListening, toast]);

  const sendMessage = useCallback(async (text: string, inputMode: "text" | "dictation") => {
    stopListening();
    if (!hasDocuments) { toast({ title: "No documents indexed", description: "Please upload and index documents first.", variant: "destructive" }); return; }
    if (!text.trim()) return;
    const filtersAtSendTime = { ...currentFiltersRef.current };
    setFiltersLocked(true);
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: text.trim(), inputMode, timestamp: new Date() };
    addMessage(userMessage);
    setQuestion("");
    setIsQuerying(true);
    setSources([]);
    const recentHistory = chatHistory.slice(-8).map(msg => ({ role: msg.role, content: msg.content }));
    try {
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: { question: text.trim(), documentType: filtersAtSendTime.docType || undefined, uploadDate: filtersAtSendTime.uploadDate || undefined, filterSite: filtersAtSendTime.site || undefined, equipmentType: filtersAtSendTime.equipmentType || undefined, equipmentMake: filtersAtSendTime.equipmentMake || undefined, equipmentModel: filtersAtSendTime.equipmentModel || undefined, history: recentHistory, isConversationMode: false },
      });
      if (error) throw error;
      const assistantMessage: ChatMessage = { id: `assistant-${Date.now()}`, role: "assistant", content: data.answer, timestamp: new Date() };
      addMessage(assistantMessage);
      setSources(data.sources || []);
      toast({ title: "Answer generated", description: `Found ${data.sources?.length || 0} relevant sources.` });
    } catch (error: any) {
      console.error("Error querying assistant:", error);
      toast({ title: "Error querying assistant", description: error.message || "An unexpected error occurred.", variant: "destructive" });
    } finally { setIsQuerying(false); setFiltersLocked(false); }
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
    let finalTranscript = '';
    recognition.onstart = () => { setIsDictating(true); };
    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) { finalTranscript += transcript + ' '; } else { interimTranscript += transcript; }
      }
      setQuestion(finalTranscript + interimTranscript);
    };
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') { toast({ title: "Microphone permission denied", description: "Please enable mic access in your browser.", variant: "destructive" }); }
      else if (event.error !== 'aborted') { toast({ title: "Speech recognition error", description: event.error, variant: "destructive" }); }
      setIsDictating(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => { setIsDictating(false); recognitionRef.current = null; };
    recognition.start();
  }, [toast]);

  const handleDictateToggle = () => { if (isDictating) { stopListening(); } else { startDictation(); } };

  const handleConversationToggle = () => {
    if (isConversationMode) {
      conversationActiveRef.current = false;
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
      setTimeout(() => { startConversationListening(); }, 100);
    }
  };

  const handleSend = () => { if (question.trim()) { sendMessage(question, isDictating ? "dictation" : "text"); } };

  const handleFilterChange = (key: keyof ConversationFilters, value: string | undefined) => {
    setCurrentFilters(prev => ({ ...prev, [key]: value === "__all__" ? "" : value }));
  };

  const hasText = question.trim().length > 0;
  const showSendButton = hasText && !isConversationMode;
  const showConversationButton = !hasText && !isConversationMode && !isDictating;

  const getUserLabel = (msg: ChatMessage) => {
    if (msg.inputMode === "voice") return "You (voice)";
    if (msg.inputMode === "dictation") return "You (dictation)";
    return "You";
  };

  const activeFilters = Object.entries(currentFilters).filter(([_, v]) => v && v !== "");

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[500px] overflow-hidden">
      <div className="w-80 flex-shrink-0 hidden md:flex flex-col bg-sidebar-background border-r border-border/50 rounded-l-2xl">
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

      <div className="flex-1 flex flex-col min-w-0 bg-background rounded-r-2xl border border-border/50 border-l-0">
        <div className="px-8 py-5 border-b border-border/50 bg-card flex-shrink-0 rounded-tr-2xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground tracking-tight">
                Technician Assistant
              </h2>
              <p className="text-sm text-muted-foreground font-normal mt-0.5">
                Ask questions about your equipment and procedures
              </p>
            </div>
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

        {hasDocuments && (
          <Collapsible defaultOpen={false} className="border-b border-border/50 bg-muted/20 flex-shrink-0">
            <CollapsibleTrigger asChild>
              <button className="w-full px-8 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 transition-transform duration-200 [[data-state=open]>&]:rotate-90" />
                  <Label className="text-sm font-medium cursor-pointer">Optional Filters</Label>
                  <span className="text-xs text-muted-foreground font-normal ml-1">Scopes retrieval</span>
                </div>
                <span className="text-xs text-muted-foreground font-normal">Applies to next question</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-8 pb-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="filter-doc-type" className="text-xs">Document Type</Label>
                    <Select value={currentFilters.docType || "__all__"} onValueChange={(v) => handleFilterChange("docType", v)} disabled={filtersLocked}>
                      <SelectTrigger id="filter-doc-type" className="h-9"><SelectValue placeholder="All types" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All types</SelectItem>
                        {docTypes.map((type) => (<SelectItem key={type} value={type}>{type}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="filter-site" className="text-xs">Site</Label>
                    <Select value={currentFilters.site || "__all__"} onValueChange={(v) => handleFilterChange("site", v)} disabled={filtersLocked}>
                      <SelectTrigger id="filter-site" className="h-9"><SelectValue placeholder="All sites" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All sites</SelectItem>
                        {sites.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="filter-equipment-type" className="text-xs">Equipment Type</Label>
                    <Select value={currentFilters.equipmentType || "__all__"} onValueChange={(v) => handleFilterChange("equipmentType", v)} disabled={filtersLocked}>
                      <SelectTrigger id="filter-equipment-type" className="h-9"><SelectValue placeholder="All types" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All types</SelectItem>
                        {equipmentTypes.map((type) => (<SelectItem key={type} value={type}>{type}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="filter-equipment-make" className="text-xs">Equipment Make</Label>
                    <Select value={currentFilters.equipmentMake || "__all__"} onValueChange={(v) => handleFilterChange("equipmentMake", v)} disabled={filtersLocked}>
                      <SelectTrigger id="filter-equipment-make" className="h-9"><SelectValue placeholder="All makes" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All makes</SelectItem>
                        {equipmentMakes.map((make) => (<SelectItem key={make} value={make}>{make}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="filter-equipment-model" className="text-xs">Equipment Model</Label>
                    <Select value={currentFilters.equipmentModel || "__all__"} onValueChange={(v) => handleFilterChange("equipmentModel", v)} disabled={filtersLocked}>
                      <SelectTrigger id="filter-equipment-model" className="h-9"><SelectValue placeholder="All models" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All models</SelectItem>
                        {equipmentModels.map((model) => (<SelectItem key={model} value={model}>{model}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-muted-foreground italic">
                    Use filters when documents overlap, to reduce ambiguity and enforce scoping.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => setCurrentFilters({ docType: "", uploadDate: undefined, site: "", equipmentType: "", equipmentMake: "", equipmentModel: "" })}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="flex-1 overflow-hidden flex flex-col p-6 min-h-0">
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
                            <><VolumeX className="h-3.5 w-3.5 mr-1.5" />Stop</>
                          ) : (
                            <><Volume2 className="h-3.5 w-3.5 mr-1.5" />Listen</>
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

          <div className="px-8 py-5 border-t border-border/50 bg-card flex-shrink-0 rounded-br-2xl">
            {!canWrite ? (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">You have read-only access to the assistant.</p>
                <p className="text-xs mt-1">Contact an administrator for write permissions.</p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-2">
                <div className="relative rounded-xl border border-border/50 bg-muted/30 focus-within:bg-background transition-colors overflow-hidden">
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
                    rows={2}
                    disabled={isQuerying || isConversationMode}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !isConversationMode && hasText) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    className="resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent pr-24"
                  />
                  
                  {activeFilters.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                      {activeFilters.map(([key, value]) => (
                        <Badge
                          key={key}
                          variant="secondary"
                          className="text-xs gap-1 h-6 px-2 bg-primary/10 text-primary hover:bg-primary/20"
                        >
                          {value}
                          <X
                            className="h-3 w-3 cursor-pointer"
                            onClick={() => handleFilterChange(key as keyof ConversationFilters, "__all__")}
                          />
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="absolute right-2 bottom-2 flex items-center gap-1">
                    {isConversationMode && (
                      <Button onClick={handleConversationToggle} variant="destructive" size="icon" className="h-9 w-9 rounded-lg" title="End conversation">
                        <Square className="h-4 w-4" />
                      </Button>
                    )}
                    {!isConversationMode && (
                      <>
                        <Button onClick={handleDictateToggle} disabled={isQuerying || !hasDocuments} variant={isDictating ? "destructive" : "ghost"} size="icon"
                          className={cn("h-9 w-9 rounded-lg transition-all duration-200", isDictating && "animate-pulse")}
                          title={isDictating ? "Stop recording" : "Start dictation"}>
                          <Mic className="h-4 w-4" />
                        </Button>
                        {showConversationButton ? (
                          <Button onClick={handleConversationToggle} disabled={isQuerying || !hasDocuments} variant="ghost" size="icon" className="h-9 w-9 rounded-lg" title="Start voice conversation">
                            <AudioWaveform className="h-4 w-4" />
                          </Button>
                        ) : showSendButton ? (
                          <Button onClick={handleSend} disabled={isQuerying || !hasDocuments || !hasText} size="icon"
                            className="h-9 w-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 shadow-sm" title="Send question">
                            {isQuerying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                
                <div className="text-xs text-muted-foreground font-normal text-center">
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
                  ) : (
                    <span>Filters persist for this conversation and apply to the next question. Collapse filters when not needed.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
