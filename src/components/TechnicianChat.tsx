import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, Mic, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
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
  const [site, setSite] = useState("");
  const [equipment, setEquipment] = useState("");
  const [faultCode, setFaultCode] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const { toast } = useToast();

  const [filterDocType, setFilterDocType] = useState<string>("");
  const [filterUploadDate, setFilterUploadDate] = useState<Date | undefined>();
  const [filterSite, setFilterSite] = useState<string>("");
  const [filterEquipmentMake, setFilterEquipmentMake] = useState<string>("");
  const [filterEquipmentModel, setFilterEquipmentModel] = useState<string>("");

  // Available filter options from documents
  const [docTypes, setDocTypes] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [equipmentMakes, setEquipmentMakes] = useState<string[]>([]);
  const [equipmentModels, setEquipmentModels] = useState<string[]>([]);

  // Speech recognition ref
  const recognitionRef = useRef<any>(null);

  // Fetch distinct filter values from documents
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const { data: documents, error } = await supabase
          .from('documents')
          .select('doc_type, site, equipment_make, equipment_model');

        if (error) throw error;

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
      } catch (error) {
        console.error('Error fetching filter options:', error);
      }
    };

    if (hasDocuments) {
      fetchFilterOptions();
    }
  }, [hasDocuments]);

  const handleAskAssistant = async () => {
    if (!hasDocuments) {
      toast({
        title: "No documents indexed",
        description: "Please upload and index documents first.",
        variant: "destructive",
      });
      return;
    }

    if (!question.trim()) {
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

    try {
      const { data, error } = await supabase.functions.invoke("rag-query", {
        body: {
          question: question.trim(),
          site: site.trim() || undefined,
          equipment: equipment.trim() || undefined,
          faultCode: faultCode.trim() || undefined,
          documentType: filterDocType || undefined,
          uploadDate: filterUploadDate ? format(filterUploadDate, 'yyyy-MM-dd') : undefined,
          filterSite: filterSite || undefined,
          equipmentMake: filterEquipmentMake || undefined,
          equipmentModel: filterEquipmentModel || undefined,
        },
      });

      if (error) throw error;

      setAnswer(data.answer);
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

    recognition.continuous = true; // Keep listening
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onstart = () => {
      setIsListening(true);
      toast({
        title: "Recording...",
        description: "Click the mic button again to stop.",
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
        setQuestion(finalTranscript.trim());
        toast({
          title: "Speech captured",
          description: "Your question has been transcribed.",
        });
      } else {
        toast({
          title: "No speech detected",
          description: "Try speaking again.",
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
                          "h-9 w-full justify-start text-left font-normal",
                          !filterUploadDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filterUploadDate ? format(filterUploadDate, "PPP") : "Any date"}
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="site" className="text-sm">Site</Label>
              <Input
                id="site"
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="e.g., Site-23 Phoenix"
                disabled={isQuerying}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="equipment" className="text-sm">Equipment</Label>
              <Input
                id="equipment"
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                placeholder="e.g., Inverter XG-4000 #4"
                disabled={isQuerying}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fault" className="text-sm">Fault Code</Label>
              <Input
                id="fault"
                value={faultCode}
                onChange={(e) => setFaultCode(e.target.value)}
                placeholder="e.g., F312"
                disabled={isQuerying}
              />
            </div>
          </div>

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
              onClick={handleAskAssistant}
              disabled={isQuerying || !hasDocuments}
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
              disabled={isQuerying}
              variant={isListening ? "destructive" : "outline"}
              size="icon"
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
            <h3 className="text-lg font-semibold text-foreground">Answer</h3>
            <div className="prose prose-sm max-w-none text-foreground">
              <p className="whitespace-pre-wrap">{answer}</p>
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