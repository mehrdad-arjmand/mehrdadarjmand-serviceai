import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

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
  documentIds: string[];
  dynamicMetadata: Record<string, string>;
  accessRole: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  filters: ConversationFilters;
  createdAt: Date;
  updatedAt: Date;
}

export function getDefaultFilters(): ConversationFilters {
  return {
    docType: "",
    uploadDate: undefined,
    site: "",
    equipmentType: "",
    equipmentMake: "",
    equipmentModel: "",
    documentIds: [],
    dynamicMetadata: {},
    accessRole: "",
  };
}

function generateTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find(m => m.role === "user");
  if (!firstUserMessage) return "New conversation";
  const content = firstUserMessage.content.trim();
  return content.length > 50 ? content.substring(0, 50) + "..." : content;
}

export function useChatHistory(projectId?: string) {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const activeConversationIdRef = useRef(activeConversationId);
  useEffect(() => { activeConversationIdRef.current = activeConversationId; }, [activeConversationId]);

  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  // Load sessions from DB
  const loadSessions = useCallback(async () => {
    if (!userId || !projectId) {
      setConversations([]);
      setActiveConversationId(null);
      setIsLoading(false);
      return;
    }

    try {
      const { data: sessions, error } = await supabase
        .from('chat_sessions')
        .select('id, title, summary, created_at, updated_at')
        .eq('user_id', userId)
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Error loading sessions:', error);
        setIsLoading(false);
        return;
      }

      if (!sessions || sessions.length === 0) {
        setConversations([]);
        setActiveConversationId(null);
        setIsLoading(false);
        return;
      }

      // Load messages for all sessions
      const sessionIds = sessions.map(s => s.id);
      const { data: messages, error: msgError } = await supabase
        .from('chat_messages')
        .select('id, session_id, role, content, sources, input_mode, created_at')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: true });

      if (msgError) {
        console.error('Error loading messages:', msgError);
      }

      const messagesBySession = new Map<string, ChatMessage[]>();
      (messages || []).forEach(msg => {
        const list = messagesBySession.get(msg.session_id) || [];
        list.push({
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: msg.content,
          inputMode: msg.input_mode as "text" | "dictation" | "voice" | undefined,
          timestamp: new Date(msg.created_at),
          sources: msg.sources as unknown as ChatSource[] | undefined,
        });
        messagesBySession.set(msg.session_id, list);
      });

      const convs: Conversation[] = sessions.map(s => ({
        id: s.id,
        title: s.title,
        messages: messagesBySession.get(s.id) || [],
        filters: getDefaultFilters(),
        createdAt: new Date(s.created_at),
        updatedAt: new Date(s.updated_at),
      }));

      setConversations(convs);
      // Restore last active or pick first
      const stored = localStorage.getItem(`chat-active-${userId}-${projectId}`);
      if (stored && convs.find(c => c.id === stored)) {
        setActiveConversationId(stored);
      } else if (convs.length > 0) {
        setActiveConversationId(convs[0].id);
      } else {
        setActiveConversationId(null);
      }
    } catch (err) {
      console.error('Error in loadSessions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, projectId]);

  // Reload when user or project changes
  const prevKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${userId}-${projectId}`;
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      setIsLoading(true);
      loadSessions();
    }
  }, [userId, projectId, loadSessions]);

  // Persist active conversation ID to localStorage (lightweight)
  useEffect(() => {
    if (activeConversationId && userId && projectId) {
      localStorage.setItem(`chat-active-${userId}-${projectId}`, activeConversationId);
    }
  }, [activeConversationId, userId, projectId]);

  const currentConversation = conversations.find(c => c.id === activeConversationId) || null;
  const messages = currentConversation?.messages || [];
  const filters = currentConversation?.filters || getDefaultFilters();

  // Create a new session in DB
  const startNewConversation = useCallback(async () => {
    if (!userId || !projectId) return;

    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({ user_id: userId, project_id: projectId, title: 'New conversation' })
      .select('id, title, created_at, updated_at')
      .single();

    if (error || !data) {
      console.error('Error creating session:', error);
      return;
    }

    const newConv: Conversation = {
      id: data.id,
      title: data.title,
      messages: [],
      filters: getDefaultFilters(),
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };

    setConversations(prev => {
      const updated = [newConv, ...prev];
      conversationsRef.current = updated;
      return updated;
    });
    setActiveConversationId(data.id);
    activeConversationIdRef.current = data.id;
  }, [userId, projectId]);

  // Ensure there's an active conversation
  const ensureActiveConversation = useCallback(async (): Promise<string | null> => {
    const currentId = activeConversationIdRef.current;
    const currentConvs = conversationsRef.current;

    if (currentId && currentConvs.find(c => c.id === currentId)) {
      return currentId;
    }
    if (currentConvs.length > 0) {
      const firstId = currentConvs[0].id;
      setActiveConversationId(firstId);
      activeConversationIdRef.current = firstId;
      return firstId;
    }

    // Create new session
    if (!userId || !projectId) return null;

    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({ user_id: userId, project_id: projectId, title: 'New conversation' })
      .select('id, title, created_at, updated_at')
      .single();

    if (error || !data) {
      console.error('Error creating session:', error);
      return null;
    }

    const newConv: Conversation = {
      id: data.id,
      title: data.title,
      messages: [],
      filters: getDefaultFilters(),
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };

    setConversations(prev => {
      const updated = [newConv, ...prev];
      conversationsRef.current = updated;
      return updated;
    });
    setActiveConversationId(data.id);
    activeConversationIdRef.current = data.id;
    return data.id;
  }, [userId, projectId]);

  // Add a message: persist to DB and update local state
  const addMessage = useCallback(async (message: ChatMessage) => {
    let convId = activeConversationIdRef.current;

    if (!convId || !conversationsRef.current.find(c => c.id === convId)) {
      convId = await ensureActiveConversation();
      if (!convId) return;
    }

    // Persist to DB
    const { error } = await supabase
      .from('chat_messages')
      .insert({
        session_id: convId,
        role: message.role,
        content: message.content,
        sources: message.sources ? JSON.parse(JSON.stringify(message.sources)) : null,
        input_mode: message.inputMode || null,
      });

    if (error) {
      console.error('Error saving message:', error);
    }

    // Update local state
    setConversations(prev => {
      return prev.map(conv => {
        if (conv.id === convId) {
          const newMessages = [...conv.messages, message];
          const newTitle = conv.messages.length === 0 && message.role === "user"
            ? generateTitle([message])
            : conv.title;

          // Update title in DB if changed
          if (newTitle !== conv.title) {
            supabase.from('chat_sessions').update({ title: newTitle, updated_at: new Date().toISOString() }).eq('id', convId!).then();
          } else {
            supabase.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', convId!).then();
          }

          return {
            ...conv,
            messages: newMessages,
            title: newTitle,
            updatedAt: new Date(),
          };
        }
        return conv;
      });
    });
  }, [ensureActiveConversation]);

  // Update filters (local only - filters are ephemeral per-session UI state)
  const updateFilters = useCallback((newFilters: Partial<ConversationFilters>) => {
    const convId = activeConversationIdRef.current;
    if (!convId) return;
    setConversations(prev => prev.map(conv => {
      if (conv.id === convId) {
        return { ...conv, filters: { ...conv.filters, ...newFilters }, updatedAt: new Date() };
      }
      return conv;
    }));
  }, []);

  // Rename
  const renameConversation = useCallback(async (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    const { error } = await supabase
      .from('chat_sessions')
      .update({ title: newTitle.trim(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) console.error('Error renaming:', error);

    setConversations(prev => prev.map(conv =>
      conv.id === id ? { ...conv, title: newTitle.trim(), updatedAt: new Date() } : conv
    ));
  }, []);

  // Delete
  const deleteConversation = useCallback(async (id: string) => {
    const { error } = await supabase.from('chat_sessions').delete().eq('id', id);
    if (error) console.error('Error deleting session:', error);

    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== id);
      conversationsRef.current = filtered;
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

  // Switch
  const switchConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    activeConversationIdRef.current = id;
  }, []);

  // Reorder (local only)
  const reorderConversations = useCallback((fromIndex: number, toIndex: number) => {
    setConversations(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      conversationsRef.current = updated;
      return updated;
    });
  }, []);

  // Clear current conversation
  const clearCurrentConversation = useCallback(async () => {
    const convId = activeConversationIdRef.current;
    if (!convId) return;

    // Delete all messages for this session
    await supabase.from('chat_messages').delete().eq('session_id', convId);
    await supabase.from('chat_sessions').update({ title: 'New conversation', summary: null, updated_at: new Date().toISOString() }).eq('id', convId);

    setConversations(prev => prev.map(conv =>
      conv.id === convId ? { ...conv, messages: [], title: 'New conversation', updatedAt: new Date() } : conv
    ));
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
    isLoading,
  };
}
