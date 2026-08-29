"use client";

import { useState } from "react";

type CopyCommandProps = {
  command: string;
  label?: string;
};

export function CopyCommand({ command, label = "Copy" }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-stone-300 bg-stone-50 dark:border-white/12 dark:bg-[#0d0d0f]">
      <div className="flex items-center justify-between gap-3 border-stone-200 border-b px-3 py-2 dark:border-white/8">
        <span className="font-mono text-[11px] text-stone-500 dark:text-white/40">
          bash
        </span>
        <button
          className="font-mono text-[11px] text-stone-700 transition-colors hover:text-stone-900 dark:text-white/55 dark:hover:text-white"
          onClick={handleCopy}
          type="button"
        >
          {copied ? "Copied" : label}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] text-stone-800 leading-relaxed dark:text-white/80">
        <code>{command}</code>
      </pre>
    </div>
  );
}
