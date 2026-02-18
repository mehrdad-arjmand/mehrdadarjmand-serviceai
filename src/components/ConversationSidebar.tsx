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
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* New chat button — px-6 to align with logo */}
        <div className="px-6 pb-2 pt-2 flex-shrink-0">
          <Button
            onClick={onNewConversation}
            variant="outline"
            className="w-full justify-start gap-2 h-9 bg-sidebar-accent/60 hover:bg-sidebar-accent border-sidebar-border/50 rounded-xl transition-all duration-200"
          >
            <Plus className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium text-sm">New chat</span>
          </Button>
        </div>

        {/* Conversation list — isolated scroll, does NOT scroll with main page */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="pb-3 space-y-0.5">
            {conversations.length === 0 ? (
              <div className="px-6 py-4 text-center text-sm text-sidebar-foreground/50">
                No conversations yet
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group flex items-center gap-2 mx-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150",
                    conv.id === activeConversationId
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                  )}
                  onClick={() => onSelectConversation(conv.id)}
                >
                  <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 opacity-40" />

                  {editingId === conv.id ? (
                    <div
                      className="flex items-center gap-1 flex-1 min-w-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Input
                        ref={inputRef}
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={handleRenameConfirm}
                        className="h-6 text-xs py-0 px-1 flex-1"
                      />
                      <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0" onClick={handleRenameConfirm}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-5 w-5 flex-shrink-0" onClick={handleRenameCancel}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/*
                        Text truncates BEFORE the 3-dot button.
                        The button is always in the flex layout (takes up space),
                        just invisible until hover — this guarantees no overlap.
                      */}
                      <p className="text-sm truncate flex-1 min-w-0">{conv.title}</p>

                      {/* 3-dot — inline, always reserves space, visible on hover */}
                      <div
                        className="flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-sidebar-foreground/60 hover:text-sidebar-foreground"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-36 bg-popover border border-border shadow-lg z-50"
                          >
                            {onRenameConversation && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingId(conv.id);
                                  setEditingTitle(conv.title);
                                }}
                              >
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
                    </>
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
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
