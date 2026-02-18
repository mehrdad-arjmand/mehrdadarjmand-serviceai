import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, Mic, Loader2, Volume2, VolumeX, AudioWaveform, Square, X, SlidersHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";
import { renderAnswerForSpeech, selectBestVoice, createUtterance, splitIntoSentences } from "@/lib/ttsUtils";
import { useChatHistory, ChatMessage, ConversationFilters } from "@/hooks/useChatHistory";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  const [filtersModalOpen, setFiltersModalOpen] = useState(false);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[500px] overflow-hidden rounded-xl border border-border/30">
      {/* Conversation Sidebar - full height */}
      <div className="w-64 flex-shrink-0 hidden md:flex flex-col bg-sidebar-background border-r border-border/30">
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

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* No header text - open and clean */}

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Chat messages - no box, clean like ChatGPT */}
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
            {chatHistory.length === 0 && !isQuerying ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Start a conversation by asking a question
              </div>
            ) : (
              <>
                {chatHistory.map((msg) => (
                  <div key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%]", msg.role === "user" ? "text-right" : "text-left")}>
                      <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                        {msg.role === "user" ? getUserLabel(msg) : "Service AI"}
                      </p>
                      {msg.role === "assistant" ? (
                        <div className="text-sm leading-relaxed text-foreground">
                          <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-p:my-2 prose-p:leading-relaxed">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => isSpeaking ? stopSpeaking() : speakText(msg.content)} className="mt-1 h-6 px-2 text-xs text-muted-foreground hover:text-foreground">
                            {isSpeaking ? <><VolumeX className="h-3 w-3 mr-1" />Stop</> : <><Volume2 className="h-3 w-3 mr-1" />Listen</>}
                          </Button>
                        </div>
                      ) : (
                        <div className="bg-primary/8 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-foreground leading-relaxed inline-block">
                          {msg.content}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isQuerying && (
                  <div className="flex gap-3 justify-start">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1.5 font-medium">Service AI</p>
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /><span>Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sources */}
          {sources.length > 0 && (
            <div className="px-8 pb-2 flex-shrink-0">
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {sources.map((source, idx) => (
                  <details key={idx} className="group">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <span className="font-medium">[{idx + 1}] {source.filename}</span>
                        <span>· {(source.similarity * 100).toFixed(0)}%</span>
                      </div>
                    </summary>
                    <div className="ml-4 p-2 bg-muted/30 rounded text-xs text-muted-foreground max-h-16 overflow-y-auto mb-1">{source.text}</div>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="px-8 py-4 border-t border-border/30 flex-shrink-0">
            {!canWrite ? (
              <div className="text-center py-4 text-muted-foreground text-sm">You have read-only access.</div>
            ) : (
              <div className="max-w-3xl mx-auto">
                <div className="relative rounded-2xl border border-border/50 bg-background shadow-sm focus-within:shadow-md transition-shadow overflow-hidden">
                  <Textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder={isConversationMode ? (conversationState === "listening" ? "Listening..." : conversationState === "processing" ? "Processing..." : conversationState === "speaking" ? "Speaking..." : "Voice active...") : "Ask a question..."}
                    rows={2}
                    disabled={isQuerying || isConversationMode}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isConversationMode && hasText) { e.preventDefault(); handleSend(); } }}
                    className="resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent pt-3 pb-10 px-4 text-sm leading-relaxed"
                  />
                  {/* Active filter chips */}
                  {activeFilters.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                      {activeFilters.map(([key, value]) => (
                        <Badge key={key} variant="secondary" className="text-xs gap-1 h-5 px-2 bg-primary/10 text-primary hover:bg-primary/20">
                          {value}
                          <X className="h-3 w-3 cursor-pointer" onClick={() => handleFilterChange(key as keyof ConversationFilters, "__all__")} />
                        </Badge>
                      ))}
                    </div>
                  )}
                  {/* Bottom toolbar */}
                  <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {hasDocuments && (
                        <Button onClick={() => setFiltersModalOpen(true)} variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1.5 rounded-lg">
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          Filters{activeFilters.length > 0 && ` (${activeFilters.length})`}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {isConversationMode ? (
                        <Button onClick={handleConversationToggle} variant="destructive" size="icon" className="h-8 w-8 rounded-lg"><Square className="h-4 w-4" /></Button>
                      ) : (
                        <>
                          <Button onClick={handleDictateToggle} disabled={isQuerying || !hasDocuments} variant={isDictating ? "destructive" : "ghost"} size="icon" className={cn("h-8 w-8 rounded-lg", isDictating && "animate-pulse")} title={isDictating ? "Stop" : "Dictate"}><Mic className="h-4 w-4" /></Button>
                          {showConversationButton && <Button onClick={handleConversationToggle} disabled={isQuerying || !hasDocuments} variant="ghost" size="icon" className="h-8 w-8 rounded-lg"><AudioWaveform className="h-4 w-4" /></Button>}
                          {showSendButton && <Button onClick={handleSend} disabled={isQuerying || !hasDocuments || !hasText} size="icon" className="h-8 w-8 rounded-lg bg-foreground text-background hover:bg-foreground/90">{isQuerying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {!hasDocuments && <p className="text-xs text-muted-foreground text-center mt-2">Upload documents to start querying</p>}
              </div>
            )}
          </div>
        </div>

        {/* Filters Modal */}
        <Dialog open={filtersModalOpen} onOpenChange={setFiltersModalOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Query Filters</DialogTitle>
              <DialogDescription>Scope retrieval to specific documents.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-3">
              {[
                { label: "Document Type", key: "docType" as keyof ConversationFilters, options: docTypes },
                { label: "Site", key: "site" as keyof ConversationFilters, options: sites },
                { label: "Equipment Type", key: "equipmentType" as keyof ConversationFilters, options: equipmentTypes },
                { label: "Equipment Make", key: "equipmentMake" as keyof ConversationFilters, options: equipmentMakes },
                { label: "Equipment Model", key: "equipmentModel" as keyof ConversationFilters, options: equipmentModels },
              ].map(({ label, key, options }) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-xs">{label}</Label>
                  <Select value={(currentFilters[key] as string) || "__all__"} onValueChange={(v) => handleFilterChange(key, v)} disabled={filtersLocked}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={`All ${label.toLowerCase()}`} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All</SelectItem>
                      {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setCurrentFilters({ docType: "", uploadDate: undefined, site: "", equipmentType: "", equipmentMake: "", equipmentModel: "" })}>Reset</Button>
              <Button onClick={() => setFiltersModalOpen(false)}>Apply</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
