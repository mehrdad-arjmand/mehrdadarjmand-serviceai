import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

interface CitationCapsuleProps {
  sourceNumber: number;
  sourceText: string;
  filename: string;
  documentId: string;
  chunkIndex: number;
  onOpenDocument: (documentId: string, highlightText: string, filename: string, chunkIndex: number) => void;
}

export function CitationCapsule({
  sourceNumber,
  sourceText,
  filename,
  documentId,
  chunkIndex,
  onOpenDocument,
}: CitationCapsuleProps) {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenDocument(documentId, sourceText, filename, chunkIndex);
          }}
          className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-primary/15 text-primary text-[10px] font-bold cursor-pointer hover:bg-primary/25 transition-colors align-super mx-[2px] leading-none"
        >
          {sourceNumber}
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-80 max-h-64 overflow-y-auto z-[100]">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{filename}</p>
          <p className="text-sm leading-relaxed text-foreground">
            {sourceText.length > 500 ? sourceText.slice(0, 500) + "…" : sourceText}
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
