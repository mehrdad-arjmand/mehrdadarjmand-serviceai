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

interface TechnicianChatProps {
  hasDocuments: boolean;
  chunksCount: number;
}

interface Source {
  filename: string;
  chunkIndex: number;
  text: string;
  similarity: number;
}

export const TechnicianChat = ({ hasDocuments, chunksCount }: TechnicianChatProps) => {
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { toast } = useToast();

  // Use persistent chat history hook
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
  } = useChatHistory();

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

  // Process a conversation message
  const processConversationMessage = useCallback(async (text: string) => {
    if (!hasDocuments) {
      toast({
        title: "No documents indexed",
        description: "Please upload and index documents first.",
        variant: "destructive",
      });
      return;
    }

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
          documentType: conversationFilters.docType || undefined,
          uploadDate: conversationFilters.uploadDate || undefined,
          filterSite: conversationFilters.site || undefined,
          equipmentType: conversationFilters.equipmentType || undefined,
          equipmentMake: conversationFilters.equipmentMake || undefined,
          equipmentModel: conversationFilters.equipmentModel || undefined,
          history: recentHistory,
          isConversationMode: true,
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

      if (data.answer && conversationActiveRef.current) {
        setConversationState("speaking");
        speakText(data.answer, () => {
          if (conversationActiveRef.current) {
            setTimeout(() => {
              if (conversationActiveRef.current) {
                startConversationListening();
              }
            }, 300);
          }
        });
      }

    } catch (error: any) {
      console.error("Error querying assistant:", error);
      toast({
        title: "Error querying assistant",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      
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
  }, [hasDocuments, chatHistory, conversationFilters, addMessage, speakText, startConversationListening, toast]);

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
          documentType: conversationFilters.docType || undefined,
          uploadDate: conversationFilters.uploadDate || undefined,
          filterSite: conversationFilters.site || undefined,
          equipmentType: conversationFilters.equipmentType || undefined,
          equipmentMake: conversationFilters.equipmentMake || undefined,
          equipmentModel: conversationFilters.equipmentModel || undefined,
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
    }
  }, [hasDocuments, chatHistory, conversationFilters, addMessage, stopListening, toast]);

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

  // Handle filter changes - persist to conversation
  const handleFilterChange = (key: keyof ConversationFilters, value: string | undefined) => {
    updateFilters({ [key]: value === "__all__" ? "" : value });
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
    <div className="flex h-[calc(100vh-12rem)] min-h-[500px] border border-border rounded-lg overflow-hidden bg-card">
      {/* Left sidebar - Conversation list */}
      <div className="w-64 flex-shrink-0 hidden md:block">
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onNewConversation={startNewConversation}
          onSelectConversation={switchConversation}
          onDeleteConversation={deleteConversation}
        />
      </div>

      {/* Main chat panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="p-4 border-b border-border bg-card flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Technician Assistant
              </h2>
              <p className="text-sm text-muted-foreground">
                Ask questions about your equipment and procedures
              </p>
            </div>
            {/* Mobile: New conversation button */}
            <Button
              variant="outline"
              size="sm"
              onClick={startNewConversation}
              className="h-8 md:hidden"
              title="Start new conversation"
            >
              New
            </Button>
          </div>
        </div>

        {/* Filters Section */}
        {hasDocuments && (
          <div className="p-4 border-b border-border bg-muted/30 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-sm font-medium">Optional Filters</Label>
              <span className="text-xs text-muted-foreground">Leave empty to search all documents</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Document Type */}
              <div className="space-y-1.5">
                <Label htmlFor="filter-doc-type" className="text-xs">Document Type</Label>
                <Select 
                  value={conversationFilters.docType || "__all__"} 
                  onValueChange={(v) => handleFilterChange("docType", v)}
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
                      className={cn(
                        "h-9 w-full justify-between text-left font-normal",
                        !conversationFilters.uploadDate && "text-muted-foreground"
                      )}
                    >
                      {conversationFilters.uploadDate 
                        ? format(parse(conversationFilters.uploadDate, 'yyyy-MM-dd', new Date()), "PPP") 
                        : "Any date"}
                      <CalendarIcon className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={conversationFilters.uploadDate 
                        ? parse(conversationFilters.uploadDate, 'yyyy-MM-dd', new Date()) 
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
                  value={conversationFilters.site || "__all__"} 
                  onValueChange={(v) => handleFilterChange("site", v)}
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
                  value={conversationFilters.equipmentType || "__all__"} 
                  onValueChange={(v) => handleFilterChange("equipmentType", v)}
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
                  value={conversationFilters.equipmentMake || "__all__"} 
                  onValueChange={(v) => handleFilterChange("equipmentMake", v)}
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
                  value={conversationFilters.equipmentModel || "__all__"} 
                  onValueChange={(v) => handleFilterChange("equipmentModel", v)}
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
        <div className="flex-1 overflow-hidden flex flex-col p-4 min-h-0">
          {/* Chat History - guaranteed minimum height */}
          <div 
            ref={chatContainerRef}
            className="flex-1 min-h-[200px] overflow-y-auto space-y-3 p-3 bg-muted/20 rounded-lg border border-border"
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
              </>
            )}
          </div>

          {/* Sources - constrained max height with scroll */}
          {sources.length > 0 && (
            <div className="mt-3 flex-shrink-0 max-h-[30%]">
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Referenced Context ({sources.length} sources)
              </h4>
              <div className="space-y-2 max-h-32 overflow-y-auto">
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
                    <div className="mt-1 ml-6 p-2 bg-background border border-border rounded text-xs text-muted-foreground max-h-24 overflow-y-auto">
                      {source.text}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Input Area - fixed at bottom */}
        <div className="p-4 border-t border-border bg-card flex-shrink-0">
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
                ) : isDictating ? (
                  <span className="text-primary animate-pulse">Recording... Click mic to stop</span>
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
              
              {/* Right side - action buttons */}
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
                      variant={isDictating ? "destructive" : "ghost"}
                      size="icon"
                      className={cn(
                        "h-9 w-9 rounded-full",
                        isDictating && "animate-pulse"
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
      </div>
    </div>
  );
};
