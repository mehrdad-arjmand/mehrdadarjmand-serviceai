import { useState, useRef, useEffect } from "react";
import { Plus, MessageSquare, MoreHorizontal, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Conversation } from "@/hooks/useChatHistory";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation?: (id: string, newTitle: string) => void;
  onReorderConversations?: (fromIndex: number, toIndex: number) => void;
  canDelete?: boolean;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  canDelete = true,
}: ConversationSidebarProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleDeleteClick = (convId: string) => {
    setConversationToDelete(convId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (conversationToDelete) onDeleteConversation(conversationToDelete);
    setDeleteDialogOpen(false);
    setConversationToDelete(null);
  };

  const handleRenameConfirm = () => {
    if (editingId && onRenameConversation && editingTitle.trim()) {
      onRenameConversation(editingId, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const handleRenameCancel = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleRenameConfirm(); }
    else if (e.key === "Escape") handleRenameCancel();
  };

  return (
    <>
      <div className="flex flex-col h-full bg-sidebar-background">
        {/* Header */}
        <div className="p-3 pt-4">
          <Button
            onClick={onNewConversation}
            variant="outline"
            className="w-full justify-start gap-2 h-9 bg-sidebar-accent/60 hover:bg-sidebar-accent border-sidebar-border/50 rounded-xl transition-all duration-200"
          >
            <Plus className="h-4 w-4" />
            <span className="font-medium text-sm">New chat</span>
          </Button>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          <div className="px-2 pb-3 space-y-0.5">
            {conversations.length === 0 ? (
              <div className="p-4 text-center text-sm text-sidebar-foreground/50">
                No conversations yet
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150",
                    conv.id === activeConversationId
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                  )}
                  onClick={() => onSelectConversation(conv.id)}
                >
                  <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
                  <div className="flex-1 min-w-0">
                    {editingId === conv.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Input
                          ref={inputRef}
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={handleRenameKeyDown}
                          onBlur={handleRenameConfirm}
                          className="h-6 text-xs py-0 px-1"
                        />
                        <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0" onClick={handleRenameConfirm}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0" onClick={handleRenameCancel}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm truncate">{conv.title}</p>
                    )}
                  </div>

                  {/* 3-dot menu — only visible on hover */}
                  {editingId !== conv.id && (
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          {onRenameConversation && (
                            <DropdownMenuItem onClick={() => { setEditingId(conv.id); setEditingTitle(conv.title); }}>
                              Rename
                            </DropdownMenuItem>
                          )}
                          {canDelete && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleDeleteClick(conv.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation and all its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
