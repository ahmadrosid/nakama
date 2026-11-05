import * as React from "react";

import { cn } from "./utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      className={cn(
        "field-sizing-content flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:disabled:bg-input/80",
        className
      )}
      data-slot="textarea"
      ref={ref}
      {...props}
    />
  );
});

// Full-height text editor with a line-number gutter. A hidden copy of the text
// sets each row's height, so numbers stay aligned when long lines wrap.
const EditorTextarea = React.forwardRef<
  HTMLTextAreaElement,
  Omit<React.ComponentProps<"textarea">, "value"> & {
    value: string;
    onSave?: () => void;
  }
>(function EditorTextarea(
  { className, onKeyDown, onSave, value, ...props },
  ref
) {
  const lines = value.split("\n");

  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-auto overscroll-contain bg-background font-mono text-[13px] leading-6",
        className
      )}
      data-slot="editor-textarea"
    >
      <div className="relative min-h-full py-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-14 border-border/60 border-r bg-muted/40"
        />
        <div
          aria-hidden
          className="pointer-events-none relative grid grid-cols-[3.5rem_minmax(0,1fr)]"
        >
          {lines.map((line, index) => (
            <React.Fragment key={index}>
              <span className="select-none pr-3 text-right text-muted-foreground/70 tabular-nums">
                {index + 1}
              </span>
              <span className="whitespace-pre-wrap break-words pr-6 pl-4 text-transparent">
                {line || "\u200b"}
              </span>
            </React.Fragment>
          ))}
        </div>
        <textarea
          className="absolute inset-y-0 right-0 left-14 resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent py-4 pr-6 pl-4 text-foreground caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          data-slot="textarea"
          onKeyDown={(event) => {
            if (
              onSave &&
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "s"
            ) {
              event.preventDefault();
              onSave();
            }

            onKeyDown?.(event);
          }}
          ref={ref}
          spellCheck={false}
          value={value}
          {...props}
        />
      </div>
    </div>
  );
});

// Line and character count shown in an editor sheet's footer.
function EditorStatus({ value }: { value: string }) {
  const lines = value.split("\n").length;

  return (
    <p className="font-mono text-muted-foreground text-xs tabular-nums">
      {lines} {lines === 1 ? "line" : "lines"} · {value.length} chars
    </p>
  );
}

export { EditorStatus, EditorTextarea, Textarea };
