import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface ChatSource {
  filename: string;
  chunkIndex: number;
  text: string;
  similarity: number;
  documentId: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  inputMode?: "text" | "dictation" | "voice";
  timestamp: Date;
  sources?: ChatSource[];
}

export interface ConversationFilters {
  docType: string;
  uploadDate: string | undefined;
  site: string;
  equipmentType: string;
  equipmentMake: string;
  equipmentModel: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  filters: ConversationFilters;
  createdAt: Date;
  updatedAt: Date;
}

// Storage keys are now user+project specific
const getStorageKey = (userId: string, projectId?: string) => 
  projectId ? `service-ai-conversations-${userId}-${projectId}` : `service-ai-conversations-${userId}`;
const getActiveConversationKey = (userId: string, projectId?: string) => 
  projectId ? `service-ai-active-conversation-${userId}-${projectId}` : `service-ai-active-conversation-${userId}`;

// Default empty filters
export function getDefaultFilters(): ConversationFilters {
  return {
    docType: "",
    uploadDate: undefined,
    site: "",
    equipmentType: "",
    equipmentMake: "",
    equipmentModel: "",
  };
}

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
    filters: getDefaultFilters(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Load conversations from localStorage for a specific user
function loadConversations(userId: string | null, projectId?: string): Conversation[] {
  if (!userId) return [];
  try {
    const stored = localStorage.getItem(getStorageKey(userId, projectId));
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return parsed.map((conv: any) => ({
      ...conv,
      filters: conv.filters || getDefaultFilters(),
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

// Save conversations to localStorage for a specific user
function saveConversations(userId: string | null, conversations: Conversation[], projectId?: string) {
  if (!userId) return;
  try {
    localStorage.setItem(getStorageKey(userId, projectId), JSON.stringify(conversations));
  } catch (e) {
    console.error("Failed to save conversations:", e);
  }
}

// Load active conversation ID for a specific user
function loadActiveConversationId(userId: string | null, projectId?: string): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(getActiveConversationKey(userId, projectId));
  } catch {
    return null;
  }
}

// Save active conversation ID for a specific user
function saveActiveConversationId(userId: string | null, id: string, projectId?: string) {
  if (!userId) return;
  try {
    localStorage.setItem(getActiveConversationKey(userId, projectId), id);
  } catch (e) {
    console.error("Failed to save active conversation ID:", e);
  }
}

export function useChatHistory(projectId?: string) {
  const { user } = useAuth();
  const userId = user?.id || null;
  
  // Track previous user+project to detect changes
  const prevKeyRef = useRef<string | null>(null);
  
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations(userId, projectId));
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    const storedId = loadActiveConversationId(userId, projectId);
    const convs = loadConversations(userId, projectId);
    if (storedId && convs.find(c => c.id === storedId)) {
      return storedId;
    }
    if (convs.length > 0) {
      return convs[0].id;
    }
    return null;
  });

  // Reload conversations when user or project changes
  useEffect(() => {
    const currentKey = `${userId}-${projectId}`;
    if (prevKeyRef.current !== currentKey) {
      prevKeyRef.current = currentKey;
      
      if (userId) {
        const userConvs = loadConversations(userId, projectId);
        setConversations(userConvs);
        
        const storedId = loadActiveConversationId(userId, projectId);
        if (storedId && userConvs.find(c => c.id === storedId)) {
          setActiveConversationId(storedId);
        } else if (userConvs.length > 0) {
          setActiveConversationId(userConvs[0].id);
        } else {
          setActiveConversationId(null);
        }
      } else {
        setConversations([]);
        setActiveConversationId(null);
      }
    }
  }, [userId, projectId]);

  // USE A REF to always have the latest activeConversationId
  // This prevents stale closure issues in addMessage
  const activeConversationIdRef = useRef(activeConversationId);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Also keep conversations in a ref for addMessage
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Get current conversation
  const currentConversation = conversations.find(c => c.id === activeConversationId) || null;
  const messages = currentConversation?.messages || [];
  const filters = currentConversation?.filters || getDefaultFilters();

  // Persist conversations whenever they change
  useEffect(() => {
    saveConversations(userId, conversations, projectId);
  }, [conversations, userId, projectId]);

  // Persist active conversation ID
  useEffect(() => {
    if (activeConversationId && userId) {
      saveActiveConversationId(userId, activeConversationId, projectId);
    }
  }, [activeConversationId, userId, projectId]);

  // Ensure there's always an active conversation - returns the ID synchronously
  const ensureActiveConversation = useCallback((): string => {
    const currentId = activeConversationIdRef.current;
    const currentConvs = conversationsRef.current;
    
    // If we have a valid active conversation, return it
    if (currentId && currentConvs.find(c => c.id === currentId)) {
      return currentId;
    }
    
    // If there are conversations but no active one, select the first
    if (currentConvs.length > 0) {
      const firstId = currentConvs[0].id;
      setActiveConversationId(firstId);
      activeConversationIdRef.current = firstId;
      return firstId;
    }
    
    // No conversations exist - create one synchronously
    const newConv = createNewConversation();
    const newConvs = [newConv, ...currentConvs];
    setConversations(newConvs);
    conversationsRef.current = newConvs;
    setActiveConversationId(newConv.id);
    activeConversationIdRef.current = newConv.id;
    return newConv.id;
  }, []);

  // Add a message to the current conversation
  // CRITICAL: Uses refs to avoid stale closure issues
  const addMessage = useCallback((message: ChatMessage) => {
    // Get the latest active conversation ID from ref
    let convId = activeConversationIdRef.current;
    
    setConversations(prev => {
      let updatedConvs = [...prev];
      
      // Check if convId is valid (exists in the list)
      const convExists = convId ? updatedConvs.some(c => c.id === convId) : false;
      
      if (!convId || !convExists) {
        // Create a new conversation if needed
        const newConv = createNewConversation();
        convId = newConv.id;
        updatedConvs = [newConv, ...updatedConvs];
        // Update ref immediately
        activeConversationIdRef.current = convId;
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
  }, []);

  // Update filters for the current conversation
  const updateFilters = useCallback((newFilters: Partial<ConversationFilters>) => {
    const convId = activeConversationIdRef.current;
    if (!convId) return;
    
    setConversations(prev => prev.map(conv => {
      if (conv.id === convId) {
        return {
          ...conv,
          filters: { ...conv.filters, ...newFilters },
          updatedAt: new Date(),
        };
      }
      return conv;
    }));
  }, []);

  // Rename a conversation
  const renameConversation = useCallback((id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    
    setConversations(prev => prev.map(conv => {
      if (conv.id === id) {
        return {
          ...conv,
          title: newTitle.trim(),
          updatedAt: new Date(),
        };
      }
      return conv;
    }));
  }, []);

  // Start a new conversation
  const startNewConversation = useCallback(() => {
    const newConv = createNewConversation();
    setConversations(prev => {
      const newConvs = [newConv, ...prev];
      conversationsRef.current = newConvs;
      return newConvs;
    });
    setActiveConversationId(newConv.id);
    activeConversationIdRef.current = newConv.id;
  }, []);

  // Clear current conversation (remove messages but keep the conversation slot)
  const clearCurrentConversation = useCallback(() => {
    const convId = activeConversationIdRef.current;
    if (!convId) return;
    
    setConversations(prev => prev.map(conv => {
      if (conv.id === convId) {
        return {
          ...conv,
          messages: [],
          title: "New conversation",
          updatedAt: new Date(),
        };
      }
      return conv;
    }));
  }, []);

  // Delete a conversation
  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== id);
      conversationsRef.current = filtered;
      
      // If we deleted the active one, switch to another or create new
      if (id === activeConversationIdRef.current) {
        if (filtered.length > 0) {
          setActiveConversationId(filtered[0].id);
          activeConversationIdRef.current = filtered[0].id;
        } else {
          setActiveConversationId(null);
          activeConversationIdRef.current = null;
        }
      }
      return filtered;
    });
  }, []);

  // Switch to a conversation
  const switchConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    activeConversationIdRef.current = id;
  }, []);

  // Reorder conversations (for drag-and-drop)
  const reorderConversations = useCallback((fromIndex: number, toIndex: number) => {
    setConversations(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      conversationsRef.current = updated;
      return updated;
    });
  }, []);

  return {
    messages,
    filters,
    conversations,
    currentConversation,
    activeConversationId,
    addMessage,
    updateFilters,
    renameConversation,
    startNewConversation,
    clearCurrentConversation,
    deleteConversation,
    switchConversation,
    ensureActiveConversation,
    reorderConversations,
  };
}
