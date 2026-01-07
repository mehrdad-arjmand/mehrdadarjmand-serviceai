import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, Mic, Loader2, Volume2, VolumeX, AudioWaveform, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";
import { renderAnswerForSpeech, selectBestVoice, createUtterance, splitIntoSentences } from "@/lib/ttsUtils";
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
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface TechnicianChatProps {
  hasDocuments: boolean;
  chunksCount: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  inputMode?: "text" | "dictation" | "voice";
  timestamp: Date;
}

interface Source {
  filename: string;
  chunkIndex: number;
  text: string;
  similarity: number;
}

export const TechnicianChat = ({ hasDocuments, chunksCount }: TechnicianChatProps) => {
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { toast } = useToast();

  // Unified state for all modes
  const [isListening, setIsListening] = useState(false);
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [conversationState, setConversationState] = useState<"idle" | "listening" | "processing" | "speaking">("idle");

  // Refs
  const recognitionRef = useRef<any>(null);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceQueueRef = useRef<number>(0);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoListenRef = useRef(false);

  // Filter states
  const [filterDocType, setFilterDocType] = useState<string>("");
  const [filterUploadDate, setFilterUploadDate] = useState<Date | undefined>();
  const [filterSite, setFilterSite] = useState<string>("");
  const [filterEquipmentType, setFilterEquipmentType] = useState<string>("");
  const [filterEquipmentMake, setFilterEquipmentMake] = useState<string>("");
  const [filterEquipmentModel, setFilterEquipmentModel] = useState<string>("");

  // Filter options
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

  // Initialize voice
  useEffect(() => {
    const initVoice = () => {
      selectedVoiceRef.current = selectBestVoice();
    };
    initVoice();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = initVoice;
    }
    return () => {
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
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
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

  // Send message to API
  const sendMessage = useCallback(async (
    text: string,
    inputMode: "text" | "dictation" | "voice",
    speakResponse: boolean = false
  ) => {
    if (!hasDocuments) {
      toast({
        title: "No documents indexed",
        description: "Please upload and index documents first.",
        variant: "destructive",
      });
      return;
    }

    if (!text.trim()) return;

    // Add user message to chat
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text.trim(),
      inputMode,
      timestamp: new Date(),
    };
    
    setChatHistory(prev => [...prev, userMessage]);
    setQuestion("");
    setIsQuerying(true);
    setSources([]);

    // Get recent history for context
    const recentHistory = chatHistory.slice(-8).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: {
          question: text.trim(),
          documentType: filterDocType || undefined,
          uploadDate: filterUploadDate ? format(filterUploadDate, 'yyyy-MM-dd') : undefined,
          filterSite: filterSite || undefined,
          equipmentType: filterEquipmentType || undefined,
          equipmentMake: filterEquipmentMake || undefined,
          equipmentModel: filterEquipmentModel || undefined,
          history: recentHistory,
          isConversationMode: inputMode === "voice",
        },
      });

      if (error) throw error;

      // Add assistant message to chat
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        timestamp: new Date(),
      };
      
      setChatHistory(prev => [...prev, assistantMessage]);
      setSources(data.sources || []);

      // Speak if requested
      if (speakResponse && data.answer) {
        if (isConversationMode) {
          setConversationState("speaking");
        }
        speakText(data.answer, () => {
          // In conversation mode, resume listening after speaking
          if (isConversationMode && shouldAutoListenRef.current) {
            setTimeout(() => {
              if (shouldAutoListenRef.current) {
                startListening(true);
              }
            }, 300);
          }
        });
      }

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
      
      if (isConversationMode) {
        setConversationState("idle");
      }
    } finally {
      setIsQuerying(false);
    }
  }, [hasDocuments, chatHistory, filterDocType, filterUploadDate, filterSite, filterEquipmentType, filterEquipmentMake, filterEquipmentModel, isConversationMode, speakText, toast]);

  // Start listening (used for both dictation and conversation)
  const startListening = useCallback((forConversation: boolean = false) => {
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
      setIsListening(true);
      if (forConversation) {
        setConversationState("listening");
      }
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
      
      // Show live transcription in textarea
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
      
      setIsListening(false);
      if (forConversation) {
        setConversationState("idle");
      }
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      
      const trimmedTranscript = finalTranscript.trim();
      
      if (forConversation && trimmedTranscript) {
        // In conversation mode, auto-send
        setConversationState("processing");
        setQuestion("");
        sendMessage(trimmedTranscript, "voice", true);
      } else if (forConversation && !trimmedTranscript && shouldAutoListenRef.current) {
        // No speech detected in conversation mode
        toast({
          title: "No speech detected",
          description: "Listening again...",
        });
        setTimeout(() => {
          if (shouldAutoListenRef.current) {
            startListening(true);
          }
        }, 500);
      } else if (!forConversation && !trimmedTranscript) {
        toast({
          title: "No speech detected",
          description: "Please try again.",
          variant: "destructive",
        });
        setQuestion("");
      }
      // For dictation mode with transcript, leave text in textarea for user to send
    };

    recognition.start();
  }, [toast, sendMessage]);

  // Handle dictation button click
  const handleDictateToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening(false);
    }
  };

  // Handle conversation mode toggle
  const handleConversationToggle = () => {
    if (isConversationMode) {
      // End conversation
      shouldAutoListenRef.current = false;
      stopListening();
      stopSpeaking();
      setIsConversationMode(false);
      setConversationState("idle");
    } else {
      // Start conversation - immediately begin listening
      setIsConversationMode(true);
      shouldAutoListenRef.current = true;
      setQuestion("");
      setTimeout(() => {
        startListening(true);
      }, 100);
    }
  };

  // Handle send button
  const handleSend = () => {
    if (question.trim()) {
      sendMessage(question, isListening ? "dictation" : "text", false);
    }
  };

  // Determine which buttons to show
  const hasText = question.trim().length > 0;
  const showSendButton = hasText && !isConversationMode;
  const showConversationButton = !hasText && !isConversationMode && !isListening;

  // Get user label based on input mode
  const getUserLabel = (msg: ChatMessage) => {
    if (msg.inputMode === "voice") return "You (voice)";
    if (msg.inputMode === "dictation") return "You (dictation)";
    return "You";
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="space-y-4">
          {/* Header */}
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Technician Assistant
            </h2>
            <p className="text-sm text-muted-foreground">
              Ask questions about your equipment and procedures
            </p>
          </div>

          {/* Filters Section */}
          {hasDocuments && (
            <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Optional Filters</Label>
                <span className="text-xs text-muted-foreground">Leave empty to search all documents</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Document Type */}
                <div className="space-y-1.5">
                  <Label htmlFor="filter-doc-type" className="text-xs">Document Type</Label>
                  <Select value={filterDocType || "__all__"} onValueChange={(v) => setFilterDocType(v === "__all__" ? "" : v)}>
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
                        className={cn(
                          "h-9 w-full justify-between text-left font-normal",
                          !filterUploadDate && "text-muted-foreground"
                        )}
                      >
                        {filterUploadDate ? format(filterUploadDate, "PPP") : "Any date"}
                        <CalendarIcon className="h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={filterUploadDate}
                        onSelect={setFilterUploadDate}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Site */}
                <div className="space-y-1.5">
                  <Label htmlFor="filter-site" className="text-xs">Site</Label>
                  <Select value={filterSite || "__all__"} onValueChange={(v) => setFilterSite(v === "__all__" ? "" : v)}>
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
                  <Select value={filterEquipmentType || "__all__"} onValueChange={(v) => setFilterEquipmentType(v === "__all__" ? "" : v)}>
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
                  <Select value={filterEquipmentMake || "__all__"} onValueChange={(v) => setFilterEquipmentMake(v === "__all__" ? "" : v)}>
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
                  <Select value={filterEquipmentModel || "__all__"} onValueChange={(v) => setFilterEquipmentModel(v === "__all__" ? "" : v)}>
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

          {/* Unified Chat History */}
          {chatHistory.length > 0 && (
            <div 
              ref={chatContainerRef}
              className="space-y-3 max-h-96 overflow-y-auto p-3 bg-muted/20 rounded-lg border border-border"
            >
              {chatHistory.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "p-3 rounded-lg text-sm",
                    msg.role === "user" 
                      ? "bg-primary/10 ml-8" 
                      : "bg-muted mr-8"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">
                      {msg.role === "user" ? getUserLabel(msg) : "Service AI"}
                    </span>
                    {msg.role === "assistant" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => isSpeaking ? stopSpeaking() : speakText(msg.content)}
                        className="h-6 px-2 text-xs"
                      >
                        {isSpeaking ? (
                          <>
                            <VolumeX className="h-3 w-3 mr-1" />
                            Stop
                          </>
                        ) : (
                          <>
                            <Volume2 className="h-3 w-3 mr-1" />
                            Listen
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-p:my-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="text-foreground">{msg.content}</span>
                  )}
                </div>
              ))}
              
              {/* Loading indicator */}
              {isQuerying && (
                <div className="p-3 rounded-lg text-sm bg-muted mr-8">
                  <span className="text-xs text-muted-foreground block mb-1">Service AI</span>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sources */}
          {sources.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                Referenced Context ({sources.length} sources)
              </h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {sources.map((source, idx) => (
                  <details key={idx} className="group">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-start gap-2 p-2 bg-muted/50 rounded hover:bg-muted transition-colors text-sm">
                        <span className="font-medium text-primary">[{idx + 1}]</span>
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {source.filename} (Chunk {source.chunkIndex})
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Similarity: {(source.similarity * 100).toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    </summary>
                    <div className="mt-1 ml-6 p-2 bg-background border border-border rounded text-xs text-muted-foreground">
                      {source.text}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="space-y-2">
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
              className="resize-none"
            />
            
            {/* Control bar */}
            <div className="flex items-center justify-between">
              {/* Left side - status */}
              <div className="text-xs text-muted-foreground">
                {!hasDocuments ? (
                  <span>Upload documents to start ({chunksCount} chunks indexed)</span>
                ) : isListening && !isConversationMode ? (
                  <span className="text-primary animate-pulse">Recording... Click mic to stop and review</span>
                ) : isConversationMode ? (
                  <span className={cn(
                    conversationState === "listening" && "text-primary animate-pulse",
                    conversationState === "speaking" && "text-primary"
                  )}>
                    Conversation: {conversationState === "listening" ? "Listening..." : 
                                   conversationState === "processing" ? "Thinking..." : 
                                   conversationState === "speaking" ? "Speaking..." : "Ready"}
                  </span>
                ) : null}
              </div>
              
              {/* Right side - action buttons (max 2) */}
              <div className="flex items-center gap-1">
                {/* Conversation mode active: show Stop only */}
                {isConversationMode && (
                  <Button
                    onClick={handleConversationToggle}
                    variant="destructive"
                    size="icon"
                    className="h-9 w-9 rounded-full"
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
                      variant={isListening ? "destructive" : "ghost"}
                      size="icon"
                      className={cn(
                        "h-9 w-9 rounded-full",
                        isListening && "animate-pulse"
                      )}
                      title={isListening ? "Stop recording" : "Start dictation"}
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
                        className="h-9 w-9 rounded-full"
                        title="Start voice conversation"
                      >
                        <AudioWaveform className="h-4 w-4" />
                      </Button>
                    ) : showSendButton ? (
                      <Button
                        onClick={handleSend}
                        disabled={isQuerying || !hasDocuments || !hasText}
                        size="icon"
                        className="h-9 w-9 rounded-full bg-primary text-primary-foreground"
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
        </div>
      </Card>
    </div>
  );
};
