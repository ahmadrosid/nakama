"use client";

import { CheckmarkCircle01Icon, Copy01Icon } from "hugeicons-react";
import {
  type CSSProperties,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

function CodeBlockChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height="15"
      viewBox="0 0 24 24"
      width="15"
    >
      <path
        d="m8 6-6 6 6 6M16 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
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

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    },
    []
  );

  return (
    <div
      className={cn(
        "overflow-hidden bg-card",
        fillHeight && "flex min-h-0 flex-1 flex-col",
        className
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/70 border-b px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <CodeBlockChevronIcon className="shrink-0 opacity-70" />
          <span className="truncate font-medium">{label}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {showEdit && onEdit ? (
            <button
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
              onClick={onEdit}
              type="button"
            >
              Edit
            </button>
          ) : null}
          <button
            aria-label={copied ? "Copied" : "Copy code"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => void copy()}
            type="button"
          >
            {copied ? (
              <CheckmarkCircle01Icon
                aria-hidden
                className="size-3.5 text-emerald-600 dark:text-emerald-400"
              />
            ) : (
              <Copy01Icon aria-hidden className="size-3.5" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      <div
        className={cn(
          "overflow-auto bg-muted/20",
          fillHeight ? "min-h-0 flex-1" : maxScrollHeightClass
        )}
        style={gridStyle}
      >
        <div className="relative min-h-full" style={gridStyle}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-(--code-block-gutter) border-border/70 border-r bg-muted/50"
          />
          <div className="relative grid min-w-full pb-2" style={gridStyle}>
            {lines.map((line, index) => (
              <Fragment key={index}>
                <span
                  aria-hidden="true"
                  className="select-none py-0 pr-3 pl-2 text-right font-mono text-muted-foreground/80 text-xs tabular-nums leading-6"
                >
                  {index + 1}
                </span>
                <code className="block min-w-0 whitespace-pre-wrap break-words px-2 pl-3 font-mono text-foreground text-xs leading-6">
                  {line || "\u00A0"}
                </code>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
