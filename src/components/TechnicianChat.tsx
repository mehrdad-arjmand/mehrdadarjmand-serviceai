import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, Mic, Loader2, Volume2, VolumeX, AudioWaveform, Square, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useConversationMode, ConversationMessage } from "@/hooks/useConversationMode";
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

export const TechnicianChat = ({ hasDocuments, chunksCount }: TechnicianChatProps) => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { toast } = useToast();

  // Dictation state
  const [isListening, setIsListening] = useState(false);
  const [dictationPreview, setDictationPreview] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

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

  // Conversation mode handler
  const handleConversationSend = async (
    questionText: string, 
    history: ConversationMessage[], 
    isConversationMode: boolean
  ): Promise<string> => {
    const { data, error } = await supabase.functions.invoke("rag-query", {
      body: {
        question: questionText.trim(),
        documentType: filterDocType || undefined,
        uploadDate: filterUploadDate ? format(filterUploadDate, 'yyyy-MM-dd') : undefined,
        filterSite: filterSite || undefined,
        equipmentType: filterEquipmentType || undefined,
        equipmentMake: filterEquipmentMake || undefined,
        equipmentModel: filterEquipmentModel || undefined,
        history,
        isConversationMode,
      },
    });

    if (error) throw error;
    
    // Update the main answer and sources for display
    setAnswer(data.answer);
    setSources(data.sources || []);
    
    return data.answer;
  };

  const {
    isConversationMode,
    conversationState,
    conversationHistory,
    startConversation,
    endConversation,
    stopCurrentAction,
    resumeListening,
    stopSpeaking: stopConversationSpeaking,
  } = useConversationMode({ onSendMessage: handleConversationSend });

  // Fetch distinct filter values from documents and chunks
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

  const handleAskAssistant = async (questionText?: string, fromVoice: boolean = false) => {
    const queryText = questionText || question;
    
    if (!hasDocuments) {
      toast({
        title: "No documents indexed",
        description: "Please upload and index documents first.",
        variant: "destructive",
      });
      return;
    }

    if (!queryText.trim()) {
      toast({
        title: "Question required",
        description: "Please describe your issue or question.",
        variant: "destructive",
      });
      return;
    }

    setIsQuerying(true);
    setAnswer("");
    setSources([]);

    // Stop any ongoing TTS
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }

    try {
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: {
          question: queryText.trim(),
          documentType: filterDocType || undefined,
          uploadDate: filterUploadDate ? format(filterUploadDate, 'yyyy-MM-dd') : undefined,
          filterSite: filterSite || undefined,
          equipmentType: filterEquipmentType || undefined,
          equipmentMake: filterEquipmentMake || undefined,
          equipmentModel: filterEquipmentModel || undefined,
        },
      });

      if (error) throw error;

      setAnswer(data.answer);
      setSources(data.sources || []);

      // If from voice, automatically speak the answer
      if (fromVoice && data.answer) {
        speakText(data.answer);
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
    } finally {
      setIsQuerying(false);
    }
  };

  // Voice ref for TTS
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceQueueRef = useRef<number>(0);

  // Initialize voice on mount
  useEffect(() => {
    const initVoice = () => {
      selectedVoiceRef.current = selectBestVoice();
    };
    
    initVoice();
    
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = initVoice;
    }
  }, []);

  const speakText = (text: string) => {
    if (!('speechSynthesis' in window)) {
      toast({
        title: "TTS not supported",
        description: "Voice playback is not supported in this browser.",
        variant: "destructive",
      });
      return;
    }

    window.speechSynthesis.cancel();
    
    const cleanText = renderAnswerForSpeech(text);
    const sentences = splitIntoSentences(cleanText);
    
    if (sentences.length === 0) return;
    
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
      };
      
      window.speechSynthesis.speak(utterance);
    };
    
    speakNext();
  };

  const stopSpeaking = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      utteranceQueueRef.current++;
      setIsSpeaking(false);
    }
  };

  // Dictation handlers
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
      
      // Show live preview in textarea
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
        // Show preview with X/✓ controls
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
      handleAskAssistant(dictationPreview, true);
      setDictationPreview(null);
    }
  };

  const handleDictateCancel = () => {
    setDictationPreview(null);
    setQuestion("");
  };

  // Toggle conversation mode
  const handleConversationToggle = () => {
    if (isConversationMode) {
      endConversation();
    } else {
      startConversation();
    }
  };

  // Determine which buttons to show based on state
  const hasText = question.trim().length > 0;
  const showSendButton = hasText && !isConversationMode;
  const showConversationButton = !hasText && !isConversationMode && !dictationPreview;
  const isConversationActive = isConversationMode;

  return (
    <div className="space-y-6">
      {/* Main Assistant Card */}
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

          {/* Chat History - shows conversation and text responses in same area */}
          {(conversationHistory.length > 0 || answer) && (
            <div className="space-y-2 max-h-80 overflow-y-auto p-3 bg-muted/20 rounded-lg border border-border">
              {/* Conversation history */}
              {conversationHistory.map((msg, idx) => (
                <div
                  key={`conv-${idx}`}
                  className={cn(
                    "p-3 rounded-lg text-sm",
                    msg.role === "user" 
                      ? "bg-primary/10 ml-8" 
                      : "bg-muted mr-8"
                  )}
                >
                  <span className="text-xs text-muted-foreground block mb-1">
                    {msg.role === "user" ? "You (voice)" : "Service AI"}
                  </span>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-p:my-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="text-foreground">{msg.content}</span>
                  )}
                </div>
              ))}
              
              {/* Text-mode answer (only when not in conversation mode and no conversation history) */}
              {answer && conversationHistory.length === 0 && (
                <div className="p-3 rounded-lg text-sm bg-muted mr-8">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Service AI</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => isSpeaking ? stopSpeaking() : speakText(answer)}
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
                  </div>
                  <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-p:my-1">
                    <ReactMarkdown>{answer}</ReactMarkdown>
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

          {/* Input Area with ChatGPT-style bottom bar */}
          <div className="space-y-2">
            <Textarea
              id="question"
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                // Clear dictation preview if user manually edits
                if (dictationPreview) setDictationPreview(null);
              }}
              placeholder={isConversationMode ? "Voice conversation active..." : "What troubleshooting steps should I take?"}
              rows={3}
              disabled={isQuerying || isConversationActive || conversationState === "waitingForAnswer"}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isConversationMode && !dictationPreview) {
                  e.preventDefault();
                  handleAskAssistant();
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
                ) : isConversationMode && conversationState === "listening" ? (
                  <span className="text-primary animate-pulse">Listening...</span>
                ) : isConversationMode && conversationState === "waitingForAnswer" ? (
                  <span className="text-muted-foreground">Thinking...</span>
                ) : isConversationMode && conversationState === "speaking" ? (
                  <span className="text-primary">Speaking...</span>
                ) : isConversationMode ? (
                  <span className="text-primary">Conversation mode active</span>
                ) : dictationPreview ? (
                  <span className="text-primary">Review your question</span>
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

                {/* Conversation mode active: show Stop button */}
                {isConversationActive && !dictationPreview && (
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

                {/* Normal mode (no dictation preview, no conversation): show Mic and either Conversation or Send */}
                {!dictationPreview && !isConversationActive && (
                  <>
                    {/* Mic button for dictation */}
                    <Button
                      onClick={isListening ? handleDictateStop : handleDictateStart}
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

                    {/* Show Conversation button when idle (no text), Send button when typing */}
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
                        onClick={() => handleAskAssistant()}
                        disabled={isQuerying || !hasDocuments || isListening || !question.trim()}
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
