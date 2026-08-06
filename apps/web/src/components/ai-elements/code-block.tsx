"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function CodeBlockChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden="true"
    >
      <path
        d="m8 6-6 6 6 6M16 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CodeBlock({
  code,
  lang,
  className,
  fillHeight = false,
  maxScrollHeightClass = "max-h-[min(50vh,28rem)]",
  showEdit = false,
  onEdit,
}: {
  code: string;
  lang?: string | null;
  className?: string;
  fillHeight?: boolean;
  maxScrollHeightClass?: string;
  showEdit?: boolean;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lines = useMemo(() => code.split("\n"), [code]);
  const label = lang?.trim() || "text";
  const lineNumberDigits = Math.max(2, String(lines.length).length);
  const lineNumberGutterWidth = `calc(${lineNumberDigits}ch + 1.25rem)`;
  const gridStyle = {
    "--code-block-gutter": lineNumberGutterWidth,
    gridTemplateColumns: "var(--code-block-gutter) minmax(0, 1fr)",
  } as CSSProperties;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 1200);
    } catch {
      // Clipboard may be unavailable outside secure contexts.
    }
  }

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className={cn(
        "overflow-hidden bg-card",
        fillHeight && "flex min-h-0 flex-1 flex-col",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <CodeBlockChevronIcon className="shrink-0 opacity-70" />
          <span className="truncate font-medium">{label}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {showEdit && onEdit ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={onEdit}
            >
              Edit
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => void copy()}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? (
              <CheckIcon
                className="size-3.5 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
            ) : (
              <CopyIcon className="size-3.5" aria-hidden />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      <div
        className={cn(
          "relative overflow-auto bg-muted/20",
          fillHeight ? "min-h-0 flex-1" : maxScrollHeightClass,
        )}
        style={gridStyle}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-(--code-block-gutter) border-r border-border/70 bg-muted/50"
          aria-hidden="true"
        />
        <div className="relative grid min-w-full pb-2" style={gridStyle}>
          {lines.map((line, index) => (
            <Fragment key={index}>
              <span
                className="py-0 pl-2 pr-3 text-right font-mono text-xs leading-6 text-muted-foreground/80 tabular-nums select-none"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <code className="block min-w-0 whitespace-pre-wrap break-words px-2 pl-3 font-mono text-xs leading-6 text-foreground">
                {line || "\u00A0"}
              </code>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
