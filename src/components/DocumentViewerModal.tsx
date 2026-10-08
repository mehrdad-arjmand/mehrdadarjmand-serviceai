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
  chunkIndex: number;
}

export function DocumentViewerModal({
  open,
  onClose,
  documentId,
  highlightText,
  filename,
  chunkIndex,
}: DocumentViewerModalProps) {
  const [chunks, setChunks] = useState<{ text: string; chunk_index: number }[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !documentId) return;
    let cancelled = false;
    setLoading(true);
    setChunks([]);
    supabase
      .from("chunks")
      .select("text, chunk_index")
      .eq("document_id", documentId)
      .order("chunk_index")
      .range(0, 4999)
      .then(({ data }) => {
        if (cancelled) return;
        setChunks(data || []);
        setLoadedFor(documentId);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, documentId]);

  // Match by chunk_index; fall back to the cited text. -1 means full document view.
  let highlightChunkIdx = chunkIndex >= 0 ? chunks.findIndex((c) => c.chunk_index === chunkIndex) : -1;
  if (highlightChunkIdx < 0 && chunkIndex >= 0 && highlightText) {
    const probe = highlightText.slice(0, 120);
    highlightChunkIdx = chunks.findIndex((c) => c.text.includes(probe));
  }

  // Scroll the cited passage into view once the dialog has laid out (retry across frames).
  useEffect(() => {
    if (loading || loadedFor !== documentId || highlightChunkIdx < 0) return;
    let tries = 0;
    let raf = 0;
    const tick = () => {
      const el = highlightRef.current;
      const box = scrollRef.current;
      if (el && box && box.clientHeight > 0) {
        box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
        if (Math.abs(box.scrollTop - (el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2)) < 4 || tries > 30) return;
      }
      if (tries++ < 60) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loading, loadedFor, documentId, highlightChunkIdx]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base truncate">{filename}</DialogTitle>
        </DialogHeader>
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto pr-2 -mr-2">
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
