import type { SourceDocumentUIPart } from "ai";
import { createContext } from "react";

export interface ReferencedSourcesContext {
  add: (sources: SourceDocumentUIPart[] | SourceDocumentUIPart) => void;
  clear: () => void;
  remove: (id: string) => void;
  sources: (SourceDocumentUIPart & { id: string })[];
}

export const LocalReferencedSourcesContext =
  createContext<ReferencedSourcesContext | null>(null);
