import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { emptyHeaderRow, type McpHeaderRow } from "@/components/soul-tools/mcp-tab/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function mcpArgKey(arg: string, index: number, args: string[]): string {
  const priorMatches = args.slice(0, index).filter((value) => value === arg).length;
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
        <LabelTag className="text-xs text-muted-foreground" {...(htmlFor ? { htmlFor } : {})}>
          {label}
        </LabelTag>
        {hint || action ? (
          <div className="flex shrink-0 items-center gap-2">
            {hint ? <span className="text-xs text-muted-foreground/80">{hint}</span> : null}
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
        "no-scrollbar flex h-8 w-full min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-input bg-transparent px-2.5 py-1 font-mono text-sm transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        disabled &&
          "pointer-events-none cursor-not-allowed bg-input/50 opacity-50 dark:disabled:bg-input/80",
      )}
    >
      {args.map((arg, index) => (
        <span
          key={mcpArgKey(arg, index, args)}
          className="inline-flex h-5 max-w-full shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/50 pl-1.5 pr-0.5 text-xs text-foreground"
        >
          <span className="truncate">{arg}</span>
          <button
            type="button"
            disabled={disabled}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none"
            aria-label={`Remove argument ${arg}`}
            onClick={() => removeArg(index)}
          >
            <XIcon className="size-2.5" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        type="text"
        value={draft}
        disabled={disabled}
        className="min-w-[4rem] flex-1 border-0 bg-transparent p-0 font-mono text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        placeholder={args.length === 0 ? "-y" : "Add argument"}
        aria-label="Add argument"
        onChange={(event) => handleDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addArg(draft)}
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

  useEffect(() => {
    while (rowKeysRef.current.length < headers.length) {
      rowKeysRef.current.push(crypto.randomUUID());
    }
    rowKeysRef.current.length = headers.length;
  }, [headers.length]);

  function updateRow(index: number, field: keyof McpHeaderRow, value: string) {
    onChange(
      headers.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
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
          <li key={row.key.trim() || rowKeysRef.current[index]} className="flex items-start gap-2">
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <Input
                value={row.key}
                disabled={disabled}
                className="font-mono text-sm"
                aria-label={`${keyLabel} name ${index + 1}`}
                placeholder={keyLabel === "Header" ? "Authorization" : "API_KEY"}
                onChange={(event) => updateRow(index, "key", event.target.value)}
              />
              <Input
                value={row.value}
                disabled={disabled}
                className="font-mono text-sm"
                aria-label={`${valueLabel} ${index + 1}`}
                placeholder={
                  valuePlaceholder ?? (isEdit ? "Leave blank to keep" : "Bearer token")
                }
                onChange={(event) => updateRow(index, "value", event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || headers.length <= 1}
              className="mt-0.5 shrink-0"
              aria-label={`Remove header ${index + 1}`}
              onClick={() => removeRow(index)}
            >
              <Trash2Icon className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          rowKeysRef.current.push(crypto.randomUUID());
          onChange([...headers, emptyHeaderRow()]);
        }}
      >
        <PlusIcon className="size-4" aria-hidden />
        Add header
      </Button>
    </div>
  );
}
