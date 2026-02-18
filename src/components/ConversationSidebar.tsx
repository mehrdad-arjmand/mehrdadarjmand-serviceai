import { useState, useRef, useEffect } from "react";
import { Plus, MessageSquare, MoreHorizontal, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  const handleRenameStart = (conv: Conversation) => {
    if (!onRenameConversation) return;
    setEditingId(conv.id);
    setEditingTitle(conv.title);
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
      <style>{`
        .conv-item:hover .conv-three-dot {
          opacity: 1 !important;
        }
      `}</style>

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* New chat button — left edge aligns with header logo (px-6 sm, px-10 lg) */}
        <div className="flex-shrink-0 pl-6 lg:pl-10 pr-4 pt-1 pb-2">
          <Button
            onClick={onNewConversation}
            variant="outline"
            className="w-full justify-start gap-2 h-9 bg-sidebar-accent/60 hover:bg-sidebar-accent border-sidebar-border/50 rounded-xl transition-all duration-200"
          >
            <Plus className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium text-sm">New chat</span>
          </Button>
        </div>

        {/* Conversation list — use plain div with overflow-y-auto so hover CSS works */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ paddingBottom: '12px' }}>
            {conversations.length === 0 ? (
              <div className="pl-6 lg:pl-10 pr-4 py-4 text-center text-sm opacity-50">
                No conversations yet
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "conv-item flex items-center gap-2 my-px mr-4 ml-6 lg:ml-10 px-2 py-2 rounded-lg cursor-pointer",
                    conv.id === activeConversationId
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                  )}
                  onClick={() => {
                    if (editingId !== conv.id) onSelectConversation(conv.id);
                  }}
                  onDoubleClick={() => handleRenameStart(conv)}
                >
                  <MessageSquare style={{ width: '14px', height: '14px', flexShrink: 0, opacity: 0.4 }} />

                  {editingId === conv.id ? (
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}
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
                      {/* Title: truncates before the 3-dot */}
                      <span
                        style={{
                          fontSize: '14px',
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {conv.title}
                      </span>

                      {/* 3-dot: always reserves 24px space, invisible until hover via CSS */}
                      <div
                        className="conv-three-dot"
                        style={{
                          flexShrink: 0,
                          width: '24px',
                          height: '24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: 0,
                          transition: 'opacity 150ms',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              style={{
                                width: '24px',
                                height: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px',
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                color: 'inherit',
                                opacity: 0.6,
                              }}
                            >
                              <MoreHorizontal style={{ width: '14px', height: '14px' }} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-36 bg-popover border border-border shadow-lg"
                            style={{ zIndex: 9999 }}
                          >
                            {onRenameConversation && (
                              <DropdownMenuItem onClick={() => handleRenameStart(conv)}>
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
        </div>
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
