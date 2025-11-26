import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Send, Mic, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

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

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      toast({
        title: "Listening...",
        description: "Speak your question now.",
      });
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setQuestion(transcript);
      toast({
        title: "Speech captured",
        description: "Your question has been transcribed.",
      });
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      toast({
        title: "Speech recognition error",
        description: event.error,
        variant: "destructive",
      });
    };

    recognition.onend = () => {
      setIsListening(false);
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
              disabled={isQuerying || isListening}
              variant="outline"
              size="icon"
            >
              <Mic className={`h-4 w-4 ${isListening ? 'text-destructive' : ''}`} />
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