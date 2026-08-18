import { ArrowDown01Icon } from "hugeicons-react";
import type { RefObject } from "react";
import {
  findHeadingElement,
  MARKDOWN_TOC_MIN_HEADINGS,
  type MarkdownHeading,
} from "@/lib/markdown-toc";
import { cn } from "@/lib/utils";

const LEVEL_INDENT: Record<number, string> = {
  1: "pl-0",
  2: "pl-3",
  3: "pl-6",
};

export function ArtifactMarkdownToc({
  contentRef,
  headings,
}: {
  contentRef: RefObject<HTMLElement | null>;
  headings: MarkdownHeading[];
}) {
  if (headings.length < MARKDOWN_TOC_MIN_HEADINGS) {
    return null;
  }

  return (
    <details
      className="group rounded-lg border border-border bg-muted/40 px-3 py-2"
      open
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-muted-foreground text-xs [&::-webkit-details-marker]:hidden">
        <ArrowDown01Icon
          aria-hidden
          className="size-3.5 -rotate-90 transition-transform group-open:rotate-0"
        />
        Contents
      </summary>
      <nav aria-label="Table of contents" className="mt-2">
        <ul className="space-y-0.5">
          {headings.map((heading) => (
            <li
              className={LEVEL_INDENT[heading.level]}
              key={`${heading.level}-${heading.occurrence}-${heading.text}`}
            >
              <button
                className={cn(
                  "block w-full truncate rounded px-1 py-0.5 text-left text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground",
                  heading.level === 1 && "font-medium text-foreground"
                )}
                onClick={() =>
                  findHeadingElement(
                    contentRef.current,
                    heading
                  )?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                type="button"
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
