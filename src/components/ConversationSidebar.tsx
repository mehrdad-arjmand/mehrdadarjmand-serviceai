import { useState } from "react";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

// Format relative time
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
}: ConversationSidebarProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    setConversationToDelete(convId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (conversationToDelete) {
      onDeleteConversation(conversationToDelete);
    }
    setDeleteDialogOpen(false);
    setConversationToDelete(null);
  };

  const handleCancelDelete = () => {
    setDeleteDialogOpen(false);
    setConversationToDelete(null);
  };

  return (
    <>
      <div className="flex flex-col h-full bg-sidebar-background border-r border-sidebar-border">
        {/* Header with New button */}
        <div className="p-3 border-b border-sidebar-border">
          <Button
            onClick={onNewConversation}
            variant="outline"
            className="w-full justify-start gap-2 h-9 bg-sidebar-accent hover:bg-sidebar-accent/80"
          >
            <Plus className="h-4 w-4" />
            New conversation
          </Button>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {conversations.length === 0 ? (
              <div className="p-4 text-center text-sm text-sidebar-foreground/60">
                No conversations yet
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group relative flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors",
                    conv.id === activeConversationId
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                  )}
                  onClick={() => onSelectConversation(conv.id)}
                >
                  <MessageSquare className="h-4 w-4 flex-shrink-0 opacity-60" />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p className="text-sm font-medium truncate">
                      {conv.title}
                    </p>
                    <p className="text-xs opacity-60 truncate">
                      {formatRelativeTime(conv.updatedAt)}
                      {conv.messages.length > 0 && ` · ${conv.messages.length} msg${conv.messages.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/20"
                    onClick={(e) => handleDeleteClick(e, conv.id)}
                    title="Delete conversation"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation and all its messages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
