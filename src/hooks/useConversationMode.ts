import { useState, useRef, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

export type ConversationState = "idle" | "listening" | "waitingForAnswer" | "speaking";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface UseConversationModeProps {
  onSendMessage: (
    question: string,
    history: ConversationMessage[],
    isConversationMode: boolean
  ) => Promise<string>;
}

export function useConversationMode({ onSendMessage }: UseConversationModeProps) {
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [conversationState, setConversationState] = useState<ConversationState>("idle");
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const { toast } = useToast();
  
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
      stopSpeaking();
    };
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    synthesisRef.current = null;
  }, []);

  const speakText = useCallback((text: string, onEnd?: () => void) => {
    if (!('speechSynthesis' in window)) {
      toast({
        title: "TTS not supported",
        description: "Voice playback is not supported in this browser.",
        variant: "destructive",
      });
      onEnd?.();
      return;
    }

    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onend = () => {
      synthesisRef.current = null;
      onEnd?.();
    };

    utterance.onerror = () => {
      synthesisRef.current = null;
      onEnd?.();
    };

    synthesisRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [stopSpeaking, toast]);

  const startListening = useCallback((onTranscript: (transcript: string) => void) => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast({
        title: "Speech recognition not supported",
        description: "Your browser doesn't support speech recognition.",
        variant: "destructive",
      });
      return false;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onstart = () => {
      setConversationState("listening");
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
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      
      if (event.error === 'not-allowed') {
        toast({
          title: "Microphone permission denied",
          description: "Please enable mic access in your browser.",
          variant: "destructive",
        });
        endConversation();
      } else {
        toast({
          title: "Speech recognition error",
          description: event.error,
          variant: "destructive",
        });
      }
      
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (finalTranscript.trim()) {
        onTranscript(finalTranscript.trim());
      } else if (isConversationMode && conversationState === "listening") {
        // No speech detected, go back to listening
        toast({
          title: "No speech detected",
          description: "Tap to speak again.",
        });
        setConversationState("idle");
      }
    };

    recognition.start();
    return true;
  }, [toast, isConversationMode, conversationState]);

  const startConversation = useCallback(() => {
    setIsConversationMode(true);
    setConversationHistory([]);
    setConversationState("idle");
    toast({
      title: "Conversation mode started",
      description: "Tap the mic to speak with Service AI.",
    });
  }, [toast]);

  const endConversation = useCallback(() => {
    stopListening();
    stopSpeaking();
    setIsConversationMode(false);
    setConversationState("idle");
    toast({
      title: "Conversation ended",
      description: "Returning to normal mode.",
    });
  }, [stopListening, stopSpeaking, toast]);

  const handleConversationTurn = useCallback(async (transcript: string) => {
    // Add user message to history
    const userMessage: ConversationMessage = { role: "user", content: transcript };
    const newHistory = [...conversationHistory, userMessage];
    setConversationHistory(newHistory);
    setConversationState("waitingForAnswer");

    try {
      // Get answer from API
      const answer = await onSendMessage(transcript, newHistory, true);
      
      // Add assistant message to history
      const assistantMessage: ConversationMessage = { role: "assistant", content: answer };
      setConversationHistory(prev => [...prev, assistantMessage]);
      
      // Speak the answer
      setConversationState("speaking");
      speakText(answer, () => {
        // After speaking, go back to idle (user can tap to continue)
        if (isConversationMode) {
          setConversationState("idle");
        }
      });
    } catch (error) {
      console.error("Conversation turn error:", error);
      toast({
        title: "Error getting response",
        description: "Falling back to text mode.",
        variant: "destructive",
      });
      setConversationState("idle");
    }
  }, [conversationHistory, onSendMessage, speakText, isConversationMode, toast]);

  const tapToSpeak = useCallback(() => {
    if (conversationState === "listening") {
      // Stop listening and process
      stopListening();
      return;
    }

    if (conversationState === "speaking") {
      // Stop speaking and allow new input
      stopSpeaking();
      setConversationState("idle");
      return;
    }

    if (conversationState === "idle" && isConversationMode) {
      // Start listening
      startListening((transcript) => {
        handleConversationTurn(transcript);
      });
    }
  }, [conversationState, isConversationMode, startListening, stopListening, stopSpeaking, handleConversationTurn]);

  return {
    isConversationMode,
    conversationState,
    conversationHistory,
    startConversation,
    endConversation,
    tapToSpeak,
    stopSpeaking,
  };
}
