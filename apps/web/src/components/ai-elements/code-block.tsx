"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
}: {
  code: string;
  lang?: string | null;
  className?: string;
  fillHeight?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lines = useMemo(() => code.split("\n"), [code]);
  const label = lang?.trim() || "text";

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
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <CodeBlockChevronIcon className="shrink-0 opacity-70" />
          <span className="truncate font-medium">{label}</span>
        </span>
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
      <div
        className={cn(
          "overflow-auto bg-muted/20 px-1 py-2",
          fillHeight ? "min-h-0 flex-1" : "max-h-[min(50vh,28rem)]",
        )}
      >
        {lines.map((line, index) => (
          <div
            key={index}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 px-2"
          >
            <span className="select-none pt-px text-right font-mono text-xs leading-6 text-muted-foreground/70 tabular-nums">
              {index + 1}
            </span>
            <code className="block min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-foreground">
              {line || "\u00A0"}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
