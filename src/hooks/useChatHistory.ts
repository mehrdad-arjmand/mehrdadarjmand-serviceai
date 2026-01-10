import { useState, useCallback, useEffect } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  inputMode?: "text" | "dictation" | "voice";
  timestamp: Date;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const STORAGE_KEY = "service-ai-conversations";
const ACTIVE_CONVERSATION_KEY = "service-ai-active-conversation";

// Generate a title from the first user message
function generateTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find(m => m.role === "user");
  if (!firstUserMessage) return "New conversation";
  const content = firstUserMessage.content.trim();
  return content.length > 50 ? content.substring(0, 50) + "..." : content;
}

// Create a new conversation
function createNewConversation(): Conversation {
  return {
    id: `conv-${Date.now()}`,
    title: "New conversation",
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Load conversations from localStorage
function loadConversations(): Conversation[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return parsed.map((conv: any) => ({
      ...conv,
      createdAt: new Date(conv.createdAt),
      updatedAt: new Date(conv.updatedAt),
      messages: conv.messages.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      })),
    }));
  } catch {
    return [];
  }
}

// Save conversations to localStorage
function saveConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (e) {
    console.error("Failed to save conversations:", e);
  }
}

// Load active conversation ID
function loadActiveConversationId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

// Save active conversation ID
function saveActiveConversationId(id: string) {
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
  } catch (e) {
    console.error("Failed to save active conversation ID:", e);
  }
}

export function useChatHistory() {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    const storedId = loadActiveConversationId();
    const convs = loadConversations();
    // Validate that stored ID exists, otherwise use first or create new
    if (storedId && convs.find(c => c.id === storedId)) {
      return storedId;
    }
    if (convs.length > 0) {
      return convs[0].id;
    }
    return null;
  });

  // Get current conversation
  const currentConversation = conversations.find(c => c.id === activeConversationId) || null;
  const messages = currentConversation?.messages || [];

  // Persist conversations whenever they change
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // Persist active conversation ID
  useEffect(() => {
    if (activeConversationId) {
      saveActiveConversationId(activeConversationId);
    }
  }, [activeConversationId]);

  // Add a message to the current conversation
  const addMessage = useCallback((message: ChatMessage) => {
    setConversations(prev => {
      // If no active conversation, create one
      let convId = activeConversationId;
      let updatedConvs = [...prev];
      
      if (!convId) {
        const newConv = createNewConversation();
        convId = newConv.id;
        updatedConvs = [newConv, ...updatedConvs];
        setActiveConversationId(convId);
      }

      return updatedConvs.map(conv => {
        if (conv.id === convId) {
          const newMessages = [...conv.messages, message];
          return {
            ...conv,
            messages: newMessages,
            title: conv.messages.length === 0 && message.role === "user" 
              ? generateTitle([message]) 
              : conv.title,
            updatedAt: new Date(),
          };
        }
        return conv;
      });
    });
  }, [activeConversationId]);

  // Start a new conversation
  const startNewConversation = useCallback(() => {
    const newConv = createNewConversation();
    setConversations(prev => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
  }, []);

  // Clear current conversation (remove messages but keep the conversation slot)
  const clearCurrentConversation = useCallback(() => {
    if (!activeConversationId) return;
    
    setConversations(prev => prev.map(conv => {
      if (conv.id === activeConversationId) {
        return {
          ...conv,
          messages: [],
          title: "New conversation",
          updatedAt: new Date(),
        };
      }
      return conv;
    }));
  }, [activeConversationId]);

  // Delete a conversation
  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== id);
      // If we deleted the active one, switch to another or create new
      if (id === activeConversationId) {
        if (filtered.length > 0) {
          setActiveConversationId(filtered[0].id);
        } else {
          setActiveConversationId(null);
        }
      }
      return filtered;
    });
  }, [activeConversationId]);

  // Switch to a conversation
  const switchConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  // Ensure there's always an active conversation when needed
  const ensureActiveConversation = useCallback(() => {
    if (!activeConversationId || !conversations.find(c => c.id === activeConversationId)) {
      if (conversations.length > 0) {
        setActiveConversationId(conversations[0].id);
      } else {
        const newConv = createNewConversation();
        setConversations([newConv]);
        setActiveConversationId(newConv.id);
      }
    }
  }, [activeConversationId, conversations]);

  return {
    messages,
    conversations,
    currentConversation,
    activeConversationId,
    addMessage,
    startNewConversation,
    clearCurrentConversation,
    deleteConversation,
    switchConversation,
    ensureActiveConversation,
  };
}
