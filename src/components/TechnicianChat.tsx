import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, Mic, Loader2, Volume2, VolumeX, AudioWaveform, Square, X, Check } from "lucide-react";
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

interface Source {
  filename: string;
  chunkIndex: number;
  text: string;
  similarity: number;
}

// Unified message type for all interactions
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  inputMode: "text" | "voice" | "dictation";
  timestamp: Date;
}

type ConversationState = "idle" | "listening" | "waitingForAnswer" | "speaking";

export const TechnicianChat = ({ hasDocuments, chunksCount }: TechnicianChatProps) => {
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { toast } = useToast();

  // Unified chat history for all modes
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  
  // Conversation mode state
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [conversationState, setConversationState] = useState<ConversationState>("idle");

  // Dictation state
  const [isListening, setIsListening] = useState(false);
  const [dictationPreview, setDictationPreview] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const conversationRecognitionRef = useRef<any>(null);

  // Request cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Filter states
  const [filterDocType, setFilterDocType] = useState<string>("");
  const [filterUploadDate, setFilterUploadDate] = useState<Date | undefined>();
  const [filterSite, setFilterSite] = useState<string>("");
  const [filterEquipmentType, setFilterEquipmentType] = useState<string>("");
  const [filterEquipmentMake, setFilterEquipmentMake] = useState<string>("");
  const [filterEquipmentModel, setFilterEquipmentModel] = useState<string>("");

  // Available filter options from documents
  const [docTypes, setDocTypes] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>([]);
  const [equipmentMakes, setEquipmentMakes] = useState<string[]>([]);
  const [equipmentModels, setEquipmentModels] = useState<string[]>([]);

  // Voice refs for TTS
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceQueueRef = useRef<number>(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when chat updates
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // Fetch distinct filter values from documents
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const { data: documents, error: docError } = await supabase
          .from('documents')
          .select('doc_type, site, equipment_make, equipment_model');

        if (docError) throw docError;

        const { data: chunks, error: chunkError } = await supabase
          .from('chunks')
          .select('equipment')
          .not('equipment', 'is', null);

        if (chunkError) throw chunkError;

        if (documents) {
          const uniqueDocTypes = [...new Set(documents.map(d => d.doc_type).filter(Boolean))];
          const uniqueSites = [...new Set(documents.map(d => d.site).filter(Boolean))];
          const uniqueMakes = [...new Set(documents.map(d => d.equipment_make).filter(Boolean))];
          const uniqueModels = [...new Set(documents.map(d => d.equipment_model).filter(Boolean))];

          setDocTypes(uniqueDocTypes as string[]);
          setSites(uniqueSites as string[]);
          setEquipmentMakes(uniqueMakes as string[]);
          setEquipmentModels(uniqueModels as string[]);
        }

        if (chunks) {
          const uniqueEquipmentTypes = [...new Set(chunks.map(c => c.equipment).filter(Boolean))];
          setEquipmentTypes(uniqueEquipmentTypes as string[]);
        }
      } catch (error) {
        console.error('Error fetching filter options:', error);
      }
    };

    if (hasDocuments) {
      fetchFilterOptions();
    }
  }, [hasDocuments]);

  // Initialize voice on mount
  useEffect(() => {
    const initVoice = () => {
      selectedVoiceRef.current = selectBestVoice();
    };
    
    initVoice();
    
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = initVoice;
    }

    return () => {
      stopAllSpeech();
      stopConversationListening();
    };
  }, []);

  // Generate unique message ID
  const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Add message to unified chat history
  const addMessage = (role: "user" | "assistant", content: string, inputMode: "text" | "voice" | "dictation") => {
    const message: ChatMessage = {
      id: generateId(),
      role,
      content,
      inputMode,
      timestamp: new Date(),
    };
    setChatHistory(prev => [...prev, message]);
    return message.id;
  };

  // Build conversation history for API
  const buildApiHistory = () => {
    return chatHistory.slice(-8).map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  };

  // Core function to send question to API
  const sendQuestion = async (
    questionText: string, 
    inputMode: "text" | "voice" | "dictation",
    speakAnswer: boolean = false
  ) => {
    if (!hasDocuments) {
      toast({
        title: "No documents indexed",
        description: "Please upload and index documents first.",
        variant: "destructive",
      });
      return;
    }

    if (!questionText.trim()) {
      toast({
        title: "Question required",
        description: "Please describe your issue or question.",
        variant: "destructive",
      });
      return;
    }

    // Add user message to chat
    addMessage("user", questionText.trim(), inputMode);
    
    setIsQuerying(true);
    setSources([]);

    // Stop any ongoing TTS
    stopAllSpeech();

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();

    try {
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: {
          question: questionText.trim(),
          documentType: filterDocType || undefined,
          uploadDate: filterUploadDate ? format(filterUploadDate, 'yyyy-MM-dd') : undefined,
          filterSite: filterSite || undefined,
          equipmentType: filterEquipmentType || undefined,
          equipmentMake: filterEquipmentMake || undefined,
          equipmentModel: filterEquipmentModel || undefined,
          history: buildApiHistory(),
          isConversationMode: inputMode === "voice",
        },
      });

      if (error) throw error;

      // Add assistant message to chat
      addMessage("assistant", data.answer, inputMode);
      setSources(data.sources || []);

      // Speak answer if requested
      if (speakAnswer && data.answer) {
        speakText(data.answer, () => {
          // After speaking, if in conversation mode, resume listening
          if (isConversationMode) {
            startConversationListening();
          }
        });
      }

      if (!speakAnswer) {
        toast({
          title: "Answer generated",
          description: `Found ${data.sources?.length || 0} relevant sources.`,
        });
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Request cancelled');
        return;
      }
      console.error("Error querying assistant:", error);
      toast({
        title: "Error querying assistant",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsQuerying(false);
      abortControllerRef.current = null;
    }
  };

  // TTS Functions
  const speakText = (text: string, onEnd?: () => void) => {
    if (!('speechSynthesis' in window)) {
      toast({
        title: "TTS not supported",
        description: "Voice playback is not supported in this browser.",
        variant: "destructive",
      });
      onEnd?.();
      return;
    }

    window.speechSynthesis.cancel();
    
    const cleanText = renderAnswerForSpeech(text);
    const sentences = splitIntoSentences(cleanText);
    
    if (sentences.length === 0) {
      onEnd?.();
      return;
    }
    
    if (!selectedVoiceRef.current) {
      selectedVoiceRef.current = selectBestVoice();
    }

    const queueId = ++utteranceQueueRef.current;
    let currentIndex = 0;
    
    setIsSpeaking(true);
    setConversationState("speaking");
    
    const speakNext = () => {
      if (queueId !== utteranceQueueRef.current) {
        setIsSpeaking(false);
        setConversationState("idle");
        return;
      }
      
      if (currentIndex >= sentences.length) {
        setIsSpeaking(false);
        setConversationState("idle");
        onEnd?.();
        return;
      }
      
      const utterance = createUtterance(
        sentences[currentIndex],
        selectedVoiceRef.current
      );
      
      utterance.onend = () => {
        currentIndex++;
        speakNext();
      };
      
      utterance.onerror = () => {
        setIsSpeaking(false);
        setConversationState("idle");
        onEnd?.();
      };
      
      window.speechSynthesis.speak(utterance);
    };
    
    speakNext();
  };

  const stopAllSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      utteranceQueueRef.current++;
      setIsSpeaking(false);
    }
  };

  // Global stop handler - interrupts everything
  const handleGlobalStop = () => {
    // Stop TTS
    stopAllSpeech();
    
    // Cancel ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // If in conversation mode, end it
    if (isConversationMode) {
      endConversationMode();
    }
    
    // Stop dictation
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    
    setIsQuerying(false);
    setConversationState("idle");
  };

  // Dictation handlers (one-shot)
  const handleDictateStart = () => {
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
    let interimTranscript = '';

    recognition.onstart = () => {
      setIsListening(true);
      setDictationPreview(null);
    };

    recognition.onresult = (event: any) => {
      interimTranscript = '';
      
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
      
      setIsListening(false);
      setDictationPreview(null);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      
      const trimmedTranscript = finalTranscript.trim();
      if (trimmedTranscript) {
        setDictationPreview(trimmedTranscript);
        setQuestion(trimmedTranscript);
      } else {
        toast({
          title: "No speech detected",
          description: "Please try again.",
          variant: "destructive",
        });
        setDictationPreview(null);
      }
    };

    recognition.start();
  };

  const handleDictateStop = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  const handleDictateConfirm = () => {
    if (dictationPreview) {
      sendQuestion(dictationPreview, "dictation", true);
      setDictationPreview(null);
      setQuestion("");
    }
  };

  const handleDictateCancel = () => {
    setDictationPreview(null);
    setQuestion("");
  };

  // Conversation mode - continuous voice chat
  const startConversationMode = () => {
    setIsConversationMode(true);
    // Immediately start listening
    startConversationListening();
  };

  const endConversationMode = () => {
    setIsConversationMode(false);
    stopConversationListening();
    stopAllSpeech();
    setConversationState("idle");
    // Keep chat history - don't clear it
  };

  const stopConversationListening = () => {
    if (conversationRecognitionRef.current) {
      conversationRecognitionRef.current.stop();
      conversationRecognitionRef.current = null;
    }
  };

  const startConversationListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({
        title: "Speech recognition not supported",
        description: "Your browser doesn't support speech recognition.",
        variant: "destructive",
      });
      endConversationMode();
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    conversationRecognitionRef.current = recognition;

    recognition.continuous = false; // Auto-finalize on pause
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onstart = () => {
      setConversationState("listening");
    };

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Conversation recognition error:', event.error);
      
      if (event.error === 'not-allowed') {
        toast({
          title: "Microphone permission denied",
          description: "Please enable mic access in your browser.",
          variant: "destructive",
        });
        endConversationMode();
      } else if (event.error === 'no-speech') {
        // No speech detected, restart listening if still in conversation mode
        if (isConversationMode) {
          setTimeout(() => {
            if (isConversationMode) {
              startConversationListening();
            }
          }, 500);
        }
      }
      
      conversationRecognitionRef.current = null;
    };

    recognition.onend = () => {
      conversationRecognitionRef.current = null;
      
      const trimmedTranscript = finalTranscript.trim();
      if (trimmedTranscript && isConversationMode) {
        // Auto-send the question
        setConversationState("waitingForAnswer");
        sendQuestion(trimmedTranscript, "voice", true);
      } else if (isConversationMode) {
        // No speech, but still in conversation mode - restart listening
        setTimeout(() => {
          if (isConversationMode) {
            startConversationListening();
          }
        }, 500);
      }
    };

    recognition.start();
  };

  // Handle text submit
  const handleTextSubmit = () => {
    if (question.trim()) {
      sendQuestion(question, "text", false);
      setQuestion("");
    }
  };

  // Determine button states
  const hasText = question.trim().length > 0;
  const isProcessing = isQuerying || isSpeaking;
  const showStopButton = isProcessing || isConversationMode;

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

          {/* Unified Chat History - shows all interactions */}
          {chatHistory.length > 0 && (
            <div className="space-y-2 max-h-96 overflow-y-auto p-3 bg-muted/20 rounded-lg border border-border">
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
                      {msg.role === "user" 
                        ? `You${msg.inputMode === "voice" ? " (voice)" : msg.inputMode === "dictation" ? " (dictation)" : ""}` 
                        : "Service AI"}
                    </span>
                    {msg.role === "assistant" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => isSpeaking ? stopAllSpeech() : speakText(msg.content)}
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
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Input Area - directly under chat history */}
          <div className="space-y-2">
            <Textarea
              id="question"
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                if (dictationPreview) setDictationPreview(null);
              }}
              placeholder={isConversationMode ? "Voice conversation active..." : "What troubleshooting steps should I take?"}
              rows={3}
              disabled={isQuerying || isConversationMode}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isConversationMode && !dictationPreview && hasText) {
                  e.preventDefault();
                  handleTextSubmit();
                }
              }}
              className="resize-none"
            />
            
            {/* ChatGPT-style control bar */}
            <div className="flex items-center justify-between">
              {/* Left side - status info */}
              <div className="text-xs text-muted-foreground">
                {!hasDocuments ? (
                  <span>Upload documents to start ({chunksCount} chunks indexed)</span>
                ) : isListening ? (
                  <span className="text-primary animate-pulse">Recording... Click mic to stop</span>
                ) : conversationState === "listening" ? (
                  <span className="text-primary animate-pulse">Listening...</span>
                ) : conversationState === "waitingForAnswer" ? (
                  <span className="text-muted-foreground">Thinking...</span>
                ) : conversationState === "speaking" ? (
                  <span className="text-primary">Speaking...</span>
                ) : isConversationMode ? (
                  <span className="text-primary">Conversation mode active</span>
                ) : dictationPreview ? (
                  <span className="text-primary">Review your question</span>
                ) : isQuerying ? (
                  <span className="text-muted-foreground">Generating answer...</span>
                ) : null}
              </div>
              
              {/* Right side - action buttons (max 2 visible) */}
              <div className="flex items-center gap-1">
                {/* Dictation preview: show X and ✓ */}
                {dictationPreview && !isConversationMode && (
                  <>
                    <Button
                      onClick={handleDictateCancel}
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-full text-destructive hover:bg-destructive/10"
                      title="Cancel dictation"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={handleDictateConfirm}
                      disabled={isQuerying}
                      size="icon"
                      className="h-9 w-9 rounded-full bg-primary text-primary-foreground"
                      title="Confirm and send"
                    >
                      {isQuerying ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                  </>
                )}

                {/* Show Stop button when processing or in conversation mode */}
                {showStopButton && !dictationPreview && (
                  <Button
                    onClick={handleGlobalStop}
                    variant="destructive"
                    size="icon"
                    className="h-9 w-9 rounded-full"
                    title={isConversationMode ? "End conversation" : "Stop"}
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                )}

                {/* Normal mode (no dictation preview, not processing): show Mic and Conversation/Send */}
                {!dictationPreview && !showStopButton && (
                  <>
                    {/* Mic button for dictation */}
                    <Button
                      onClick={isListening ? handleDictateStop : handleDictateStart}
                      disabled={!hasDocuments}
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

                    {/* Show Conversation button when no text, Send button when typing */}
                    {hasText ? (
                      <Button
                        onClick={handleTextSubmit}
                        disabled={!hasDocuments || isListening}
                        size="icon"
                        className="h-9 w-9 rounded-full bg-primary text-primary-foreground"
                        title="Send question"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        onClick={startConversationMode}
                        disabled={!hasDocuments}
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full"
                        title="Start voice conversation"
                      >
                        <AudioWaveform className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Referenced Context - below input area */}
          {sources.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-border">
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
        </div>
      </Card>
    </div>
  );
};
