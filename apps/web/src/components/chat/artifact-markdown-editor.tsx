import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export function ArtifactMarkdownEditor({
  busy,
  draft,
  error,
  onCancel,
  onChange,
  onSave,
}: {
  busy: boolean;
  draft: string;
  error: string | null;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      {error ? (
        <p className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Textarea
        className="field-sizing-fixed min-h-[16rem] flex-1 resize-none overflow-y-auto font-mono text-xs leading-relaxed"
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        value={draft}
      />

      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          disabled={busy}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={busy} onClick={onSave} size="sm" type="button">
          {busy ? <Spinner className="size-4" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}
