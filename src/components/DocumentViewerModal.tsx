import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

interface DocumentViewerModalProps {
  open: boolean;
  onClose: () => void;
  documentId: string;
  highlightText: string;
  filename: string;
}

export function DocumentViewerModal({
  open,
  onClose,
  documentId,
  highlightText,
  filename,
}: DocumentViewerModalProps) {
  const [chunks, setChunks] = useState<{ text: string; chunk_index: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && documentId) {
      setLoading(true);
      supabase
        .from("chunks")
        .select("text, chunk_index")
        .eq("document_id", documentId)
        .order("chunk_index")
        .then(({ data }) => {
          setChunks(data || []);
          setLoading(false);
        });
    }
  }, [open, documentId]);

  useEffect(() => {
    if (!loading && chunks.length > 0 && highlightRef.current) {
      setTimeout(
        () =>
          highlightRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          }),
        150
      );
    }
  }, [loading, chunks]);

  // Find which chunk best matches the highlight text (use first 100 chars for matching)
  const matchSnippet = highlightText.slice(0, 100);
  const highlightChunkIdx = chunks.findIndex((c) => c.text.includes(matchSnippet));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base truncate">{filename}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-2 -mr-2">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : chunks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-16">
              No content available for this document.
            </p>
          ) : (
            <div className="space-y-0">
              {chunks.map((chunk, idx) => (
                <div
                  key={chunk.chunk_index}
                  ref={idx === highlightChunkIdx ? highlightRef : undefined}
                  className={
                    idx === highlightChunkIdx
                      ? "bg-primary/10 border-l-4 border-primary rounded-r-lg px-4 py-3"
                      : "px-4 py-3"
                  }
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {chunk.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
