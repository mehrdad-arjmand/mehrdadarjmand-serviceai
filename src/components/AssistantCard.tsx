import { Mic, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

// Mock chat messages for UI demonstration
const mockMessages = [
  {
    role: "user",
    content: "I am at Site-23 working on Inverter #4. Getting fault F312: DC overvoltage during startup. Any known fixes?",
    timestamp: "10:14",
  },
  {
    role: "assistant",
    content: "Yes, this fault has appeared 7 times across 3 sites. Top fix pattern: verify DC string polarity on strings 7–10, then re-run soft start. If fault persists, check DC contactor K12 for pitting.",
    timestamp: "10:14",
  },
  {
    role: "assistant",
    content: "I also found a similar incident at Site-11 (Incident #482). Root cause was moisture ingress in combiner",
    timestamp: "10:15",
  },
];

export const AssistantCard = () => {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Service AI assistant</CardTitle>
        <CardDescription>
          Ask free-form questions about your equipment and procedures.
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-4 pt-6">
        {/* Chat History */}
        <ScrollArea className="h-[300px] rounded-lg border border-border bg-muted/30 p-4">
          <div className="space-y-4">
            {mockMessages.map((message, index) => (
              <div
                key={index}
                className={`flex gap-3 ${
                  message.role === "user" ? "flex-row-reverse" : "flex-row"
                }`}
              >
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <span className="text-primary-foreground font-semibold text-xs">AI</span>
                  </div>
                )}
                <div
                  className={`flex flex-col gap-1 max-w-[80%] ${
                    message.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{message.role === "user" ? "Technician" : "Service AI Assistant"}</span>
                    <span>{message.timestamp}</span>
                  </div>
                  <div
                    className={`rounded-lg px-4 py-2.5 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border border-border"
                    }`}
                  >
                    <p className="text-sm leading-relaxed">{message.content}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="space-y-3">
          <Textarea
            placeholder="Type your question here, just like you would in ChatGPT."
            rows={3}
            className="resize-none"
          />
          
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Badge variant="secondary" className="text-xs">
                Text mode
              </Badge>
              <Badge variant="outline" className="text-xs">
                Dictation: placeholder
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="default">
                <Mic className="h-4 w-4" />
                Dictate
              </Button>
              <Button size="default">
                <Send className="h-4 w-4" />
                Ask assistant
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
