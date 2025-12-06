import { useState, useRef, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { renderAnswerForSpeech, selectBestVoice, createUtterance, splitIntoSentences } from "@/lib/ttsUtils";

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
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const shouldAutoListenRef = useRef(false);

  // Initialize voice on mount and when voices change
  useEffect(() => {
    const initVoice = () => {
      selectedVoiceRef.current = selectBestVoice();
    };
    
    initVoice();
    
    // Voices may load asynchronously
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = initVoice;
    }
    
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
    
    // Clean the text for natural speech
    const cleanText = renderAnswerForSpeech(text);
    
    // Split into sentences for natural pauses
    const sentences = splitIntoSentences(cleanText);
    
    if (sentences.length === 0) {
      onEnd?.();
      return;
    }
    
    // Ensure voice is selected
    if (!selectedVoiceRef.current) {
      selectedVoiceRef.current = selectBestVoice();
    }

    let currentIndex = 0;
    
    const speakNext = () => {
      if (currentIndex >= sentences.length) {
        synthesisRef.current = null;
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
      
      utterance.onerror = (e) => {
        console.error('[TTS] Error:', e);
        synthesisRef.current = null;
        onEnd?.();
      };
      
      synthesisRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };
    
    speakNext();
  }, [stopSpeaking, toast]);

  const startListeningInternal = useCallback((onTranscript: (transcript: string) => void) => {
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
      } else if (event.error !== 'aborted') {
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
      } else if (shouldAutoListenRef.current) {
        // No speech detected, but we're in conversation mode - show a message
        toast({
          title: "No speech detected",
          description: "Tap to speak again.",
        });
        setConversationState("idle");
      }
    };

    recognition.start();
    return true;
  }, [toast]);

  const handleConversationTurn = useCallback(async (transcript: string) => {
    const userMessage: ConversationMessage = { role: "user", content: transcript };
    const newHistory = [...conversationHistory, userMessage];
    setConversationHistory(newHistory);
    setConversationState("waitingForAnswer");

    try {
      const answer = await onSendMessage(transcript, newHistory, true);
      
      const assistantMessage: ConversationMessage = { role: "assistant", content: answer };
      setConversationHistory(prev => [...prev, assistantMessage]);
      
      setConversationState("speaking");
      speakText(answer, () => {
        if (shouldAutoListenRef.current) {
          // Auto-start listening for next turn
          setTimeout(() => {
            if (shouldAutoListenRef.current) {
              startListeningInternal((newTranscript) => {
                handleConversationTurn(newTranscript);
              });
            }
          }, 300);
        } else {
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
  }, [conversationHistory, onSendMessage, speakText, startListeningInternal, toast]);

  const startConversation = useCallback(() => {
    setIsConversationMode(true);
    setConversationHistory([]);
    shouldAutoListenRef.current = true;
    
    // Auto-start listening immediately
    setTimeout(() => {
      startListeningInternal((transcript) => {
        handleConversationTurn(transcript);
      });
    }, 100);
  }, [startListeningInternal, handleConversationTurn]);

  const endConversation = useCallback(() => {
    shouldAutoListenRef.current = false;
    stopListening();
    stopSpeaking();
    setIsConversationMode(false);
    setConversationState("idle");
    // Keep conversation history visible - don't clear it
  }, [stopListening, stopSpeaking]);

  const stopCurrentAction = useCallback(() => {
    if (conversationState === "listening") {
      stopListening();
      setConversationState("idle");
    } else if (conversationState === "speaking") {
      stopSpeaking();
      setConversationState("idle");
    }
  }, [conversationState, stopListening, stopSpeaking]);

  const resumeListening = useCallback(() => {
    if (isConversationMode && conversationState === "idle") {
      startListeningInternal((transcript) => {
        handleConversationTurn(transcript);
      });
    }
  }, [isConversationMode, conversationState, startListeningInternal, handleConversationTurn]);

  return {
    isConversationMode,
    conversationState,
    conversationHistory,
    startConversation,
    endConversation,
    stopCurrentAction,
    resumeListening,
    stopSpeaking,
  };
}
