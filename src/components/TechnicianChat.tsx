import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, Mic, Loader2, Volume2, VolumeX, Headphones, PhoneOff } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";

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
  const [isListening, setIsListening] = useState(false);
  const [isFromVoice, setIsFromVoice] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { toast } = useToast();

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

  // Speech recognition ref
  const recognitionRef = useRef<any>(null);

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
    tapToSpeak,
    stopSpeaking: stopConversationSpeaking,
  } = useConversationMode({ onSendMessage: handleConversationSend });

  // Fetch distinct filter values from documents and chunks
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        // Fetch from documents table
        const { data: documents, error: docError } = await supabase
          .from('documents')
          .select('doc_type, site, equipment_make, equipment_model');

        if (docError) throw docError;

        // Fetch equipment types from chunks table
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
    setIsFromVoice(fromVoice);

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

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    // Clean the text for natural speech (strips markdown)
    const cleanText = renderAnswerForSpeech(text);
    
    // Split into sentences for natural pauses
    const sentences = splitIntoSentences(cleanText);
    
    if (sentences.length === 0) return;
    
    // Ensure voice is selected
    if (!selectedVoiceRef.current) {
      selectedVoiceRef.current = selectBestVoice();
    }

    const queueId = ++utteranceQueueRef.current;
    let currentIndex = 0;
    
    setIsSpeaking(true);
    
    const speakNext = () => {
      // Check if this queue is still active
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

  const handleDictate = () => {
    // Toggle: if already listening, stop
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    // Start listening
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
      toast({
        title: "Recording...",
        description: "Click the mic button again to stop and send.",
      });
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
      
      // Update question field with accumulated text
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
      } else {
        toast({
          title: "Speech recognition error",
          description: event.error,
          variant: "destructive",
        });
      }
      
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      
      if (finalTranscript.trim()) {
        const trimmedTranscript = finalTranscript.trim();
        setQuestion(trimmedTranscript);
        
        // Auto-send the question
        handleAskAssistant(trimmedTranscript, true);
        
        toast({
          title: "Speech captured",
          description: "Sending your question...",
        });
      } else {
        toast({
          title: "No speech detected",
          description: "No clear speech detected. You can try again.",
          variant: "destructive",
        });
      }
    };

    recognition.start();
  };

  return (
    <div className="space-y-6">
      {/* Context Inputs */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">
                Technician Assistant
              </h2>
              <p className="text-sm text-muted-foreground">
                Ask questions about your equipment and procedures
              </p>
            </div>
            
            {/* Conversation Mode Toggle */}
            {hasDocuments && (
              <Button
                onClick={isConversationMode ? endConversation : startConversation}
                variant={isConversationMode ? "destructive" : "secondary"}
                className="gap-2"
                disabled={isQuerying}
              >
                {isConversationMode ? (
                  <>
                    <PhoneOff className="h-4 w-4" />
                    End Conversation
                  </>
                ) : (
                  <>
                    <Headphones className="h-4 w-4" />
                    Start Conversation
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Conversation Mode Banner */}
          {isConversationMode && (
            <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-primary/20 text-primary">
                    Voice Mode
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {conversationState === "idle" && "Tap mic to speak"}
                    {conversationState === "listening" && "Listening..."}
                    {conversationState === "waitingForAnswer" && "Thinking..."}
                    {conversationState === "speaking" && "Speaking..."}
                  </span>
                </div>
                {conversationState === "speaking" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={stopConversationSpeaking}
                    className="h-7 text-xs"
                  >
                    <VolumeX className="h-3 w-3 mr-1" />
                    Stop
                  </Button>
                )}
              </div>
              
              {/* Conversation State Indicator */}
              <div className="mt-2 flex justify-center">
                <Button
                  onClick={tapToSpeak}
                  disabled={conversationState === "waitingForAnswer"}
                  variant={conversationState === "listening" ? "destructive" : "default"}
                  size="lg"
                  className="rounded-full w-16 h-16"
                >
                  {conversationState === "listening" ? (
                    <div className="animate-pulse">
                      <Mic className="h-6 w-6" />
                    </div>
                  ) : conversationState === "waitingForAnswer" ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : conversationState === "speaking" ? (
                    <Volume2 className="h-6 w-6" />
                  ) : (
                    <Mic className="h-6 w-6" />
                  )}
                </Button>
              </div>
              
              {/* Conversation History */}
              {conversationHistory.length > 0 && (
                <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                  {conversationHistory.map((msg, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "p-2 rounded text-sm",
                        msg.role === "user" 
                          ? "bg-muted ml-8 text-foreground" 
                          : "bg-primary/5 mr-8 text-foreground"
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
                        msg.content
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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

          <div className="space-y-2">
            <Label htmlFor="question" className="text-sm">
              Describe the issue and your question
            </Label>
            <Textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What troubleshooting steps should I take?"
              rows={4}
              disabled={isQuerying}
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => handleAskAssistant()}
              disabled={isQuerying || !hasDocuments || isListening || isConversationMode}
              className="flex-1"
            >
              {isQuerying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Ask Assistant
                </>
              )}
            </Button>

            <Button
              onClick={handleDictate}
              disabled={isQuerying || isConversationMode}
              variant={isListening ? "destructive" : "outline"}
              size="icon"
              title={isConversationMode ? "Use the conversation mic above" : "Dictate question"}
            >
              <Mic className="h-4 w-4" />
            </Button>
          </div>

          {!hasDocuments && (
            <p className="text-sm text-muted-foreground text-center py-2">
              Upload documents to start using the assistant ({chunksCount} chunks indexed)
            </p>
          )}
        </div>
      </Card>

      {/* Answer */}
      {answer && (
        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Answer</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => isSpeaking ? stopSpeaking() : speakText(answer)}
                className="gap-1"
              >
                {isSpeaking ? (
                  <>
                    <VolumeX className="h-4 w-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <Volume2 className="h-4 w-4" />
                    Listen
                  </>
                )}
              </Button>
            </div>
            <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-li:text-foreground">
              <ReactMarkdown>{answer}</ReactMarkdown>
            </div>
          </div>
        </Card>
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <Card className="p-6">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Referenced Context ({sources.length} sources)
            </h3>
            <div className="space-y-3">
              {sources.map((source, idx) => (
                <details key={idx} className="group">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start gap-2 p-3 bg-muted/50 rounded hover:bg-muted transition-colors">
                      <span className="text-sm font-medium text-primary">
                        [{idx + 1}]
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {source.filename} (Chunk {source.chunkIndex})
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Similarity: {(source.similarity * 100).toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  </summary>
                  <div className="mt-2 ml-6 p-3 bg-background border border-border rounded text-sm text-muted-foreground">
                    {source.text}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};