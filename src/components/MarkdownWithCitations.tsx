import React from "react";
import ReactMarkdown from "react-markdown";
import { CitationCapsule } from "./CitationCapsule";
import type { ChatSource } from "@/hooks/useChatHistory";

interface MarkdownWithCitationsProps {
  content: string;
  sources?: ChatSource[];
  onOpenDocument: (documentId: string, highlightText: string, filename: string, chunkIndex: number) => void;
}

/** Match patterns like (Source 7), (Source 7, Source 13), or Source 7 standalone */
const CITATION_RE = /\(?(?:Source\s+\d+(?:,\s*Source\s+\d+)*)\)?\.?/g;

function replaceCitations(
  text: string,
  sources: ChatSource[],
  onOpenDocument: MarkdownWithCitationsProps["onOpenDocument"]
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }

    const nums = [...match[0].matchAll(/\d+/g)].map((m) => parseInt(m[0]));
    nums.forEach((num) => {
      const src = sources[num - 1];
      if (src) {
        parts.push(
          <CitationCapsule
            key={`c${key++}`}
            sourceNumber={num}
            sourceText={src.text}
            filename={src.filename}
            documentId={src.documentId}
            chunkIndex={src.chunkIndex}
            onOpenDocument={onOpenDocument}
          />
        );
      }
    });

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length > 0 ? parts : [text];
}

function processChildren(
  children: React.ReactNode,
  sources: ChatSource[],
  onOpenDocument: MarkdownWithCitationsProps["onOpenDocument"]
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      const result = replaceCitations(child, sources, onOpenDocument);
      return result.length === 1 && typeof result[0] === "string"
        ? result[0]
        : <>{result}</>;
    }
    if (React.isValidElement(child) && (child.props as any)?.children) {
      return React.cloneElement(child as React.ReactElement<any>, {
        children: processChildren(
          (child.props as any).children,
          sources,
          onOpenDocument
        ),
      });
    }
    return child;
  });
}

export function MarkdownWithCitations({
  content,
  sources,
  onOpenDocument,
}: MarkdownWithCitationsProps) {
  if (!sources || sources.length === 0) {
    return <ReactMarkdown>{content}</ReactMarkdown>;
  }

  /* Override block-level elements so we can scan their text children for citations */
  const components: Record<string, React.FC<any>> = {
    p: ({ children, node, ...rest }: any) => (
      <p {...rest}>{processChildren(children, sources, onOpenDocument)}</p>
    ),
    li: ({ children, node, ordered, ...rest }: any) => (
      <li {...rest}>{processChildren(children, sources, onOpenDocument)}</li>
    ),
    td: ({ children, node, ...rest }: any) => (
      <td {...rest}>{processChildren(children, sources, onOpenDocument)}</td>
    ),
    strong: ({ children, node, ...rest }: any) => (
      <strong {...rest}>{processChildren(children, sources, onOpenDocument)}</strong>
    ),
    em: ({ children, node, ...rest }: any) => (
      <em {...rest}>{processChildren(children, sources, onOpenDocument)}</em>
    ),
  };

  return <ReactMarkdown components={components}>{content}</ReactMarkdown>;
}
