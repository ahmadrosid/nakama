import { Add01Icon, Cancel01Icon, Delete02Icon } from "hugeicons-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import {
  emptyHeaderRow,
  type McpHeaderRow,
} from "@/components/soul-tools/mcp-tab/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClientId, syncRowKeys } from "@/lib/client-id";
import { cn } from "@/lib/utils";

function mcpArgKey(arg: string, index: number, args: string[]): string {
  const priorMatches = args
    .slice(0, index)
    .filter((value) => value === arg).length;
  return priorMatches === 0 ? arg : `${arg}:${priorMatches + 1}`;
}

export function McpFormField({
  label,
  htmlFor,
  hint,
  action,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const LabelTag = htmlFor ? "label" : "span";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <LabelTag
          className="text-muted-foreground text-xs"
          {...(htmlFor ? { htmlFor } : {})}
        >
          {label}
        </LabelTag>
        {hint || action ? (
          <div className="flex shrink-0 items-center gap-2">
            {hint ? (
              <span className="text-muted-foreground/80 text-xs">{hint}</span>
            ) : null}
            {action}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function McpArgsEditor({
  args,
  disabled,
  inputId,
  onChange,
}: {
  args: string[];
  disabled?: boolean;
  inputId?: string;
  onChange: (args: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addArg(value: string) {
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    onChange([...args, trimmed]);
    setDraft("");
  }

  function removeArg(index: number) {
    onChange(args.filter((_, argIndex) => argIndex !== index));
  }

  function handleDraftChange(value: string) {
    if (!value.includes(",")) {
      setDraft(value);
      return;
    }

    const segments = value.split(",");
    const remainder = segments.pop() ?? "";
    const nextArgs = [...args];

    for (const segment of segments) {
      const trimmed = segment.trim();

      if (trimmed) {
        nextArgs.push(trimmed);
      }
    }

    if (nextArgs.length !== args.length) {
      onChange(nextArgs);
    }

    setDraft(remainder);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addArg(draft);
      return;
    }

    if (event.key === "Backspace" && !draft && args.length > 0) {
      onChange(args.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "no-scrollbar flex h-8 w-full min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-input bg-transparent px-2.5 py-1 font-mono text-sm outline-none transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        disabled &&
          "pointer-events-none cursor-not-allowed bg-input/50 opacity-50 dark:disabled:bg-input/80"
      )}
    >
      {args.map((arg, index) => (
        <span
          className="inline-flex h-5 max-w-full shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/50 pr-0.5 pl-1.5 text-foreground text-xs"
          key={mcpArgKey(arg, index, args)}
        >
          <span className="truncate">{arg}</span>
          <button
            aria-label={`Remove argument ${arg}`}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none"
            disabled={disabled}
            onClick={() => removeArg(index)}
            type="button"
          >
            <Cancel01Icon aria-hidden className="size-2.5" />
          </button>
        </span>
      ))}
      <input
        aria-label="Add argument"
        className="min-w-[4rem] flex-1 border-0 bg-transparent p-0 font-mono text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        disabled={disabled}
        id={inputId}
        onBlur={() => addArg(draft)}
        onChange={(event) => handleDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={args.length === 0 ? "-y" : "Add argument"}
        type="text"
        value={draft}
      />
    </div>
  );
}

export function McpHeadersEditor({
  headers,
  isEdit = false,
  disabled,
  keyLabel = "Header",
  valueLabel = "Value",
  valuePlaceholder,
  onChange,
}: {
  headers: McpHeaderRow[];
  isEdit?: boolean;
  disabled?: boolean;
  keyLabel?: string;
  valueLabel?: string;
  valuePlaceholder?: string;
  onChange: (headers: McpHeaderRow[]) => void;
}) {
  const rowKeysRef = useRef<string[]>([]);
  syncRowKeys(rowKeysRef.current, headers.length);

  function updateRow(index: number, field: keyof McpHeaderRow, value: string) {
    onChange(
      headers.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      )
    );
  }

  function removeRow(index: number) {
    rowKeysRef.current.splice(index, 1);
    onChange(headers.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {headers.map((row, index) => (
          <li
            className="flex items-start gap-2"
            key={rowKeysRef.current[index]}
          >
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <Input
                aria-label={`${keyLabel} name ${index + 1}`}
                className="font-mono text-sm"
                disabled={disabled}
                onChange={(event) =>
                  updateRow(index, "key", event.target.value)
                }
                placeholder={
                  keyLabel === "Header" ? "Authorization" : "API_KEY"
                }
                value={row.key}
              />
              <Input
                aria-label={`${valueLabel} ${index + 1}`}
                className="font-mono text-sm"
                disabled={disabled}
                onChange={(event) =>
                  updateRow(index, "value", event.target.value)
                }
                placeholder={
                  valuePlaceholder ??
                  (isEdit ? "Leave blank to keep" : "Bearer token")
                }
                value={row.value}
              />
            </div>
            <Button
              aria-label={`Remove header ${index + 1}`}
              className="mt-0.5 shrink-0"
              disabled={disabled || headers.length <= 1}
              onClick={() => removeRow(index)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Delete02Icon aria-hidden className="size-4" />
            </Button>
          </li>
        ))}
      </ul>

      <Button
        disabled={disabled}
        onClick={() => {
          rowKeysRef.current.push(createClientId());
          onChange([...headers, emptyHeaderRow()]);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        <Add01Icon aria-hidden className="size-4" />
        Add header
      </Button>
    </div>
  );
}
