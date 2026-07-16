import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function McpImportConfigDialog({
  open,
  importDraft,
  importError,
  formDisabled,
  onOpenChange,
  onImportDraftChange,
  onApply,
}: {
  open: boolean;
  importDraft: string;
  importError: string | null;
  formDisabled: boolean;
  onOpenChange: (open: boolean) => void;
  onImportDraftChange: (value: string) => void;
  onApply: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-6 sm:max-w-lg">
        <DialogHeader className="gap-2">
          <DialogTitle>Import MCP config</DialogTitle>
          <DialogDescription>
            Paste JSON from your MCP client config. The first server entry will fill this form.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={importDraft}
          disabled={formDisabled}
          autoFocus
          rows={10}
          className="min-h-48 font-mono text-sm"
          placeholder={`{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "some-mcp-package"]
    }
  }
}`}
          onChange={(event) => onImportDraftChange(event.target.value)}
        />

        {importError ? (
          <p
            className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            role="alert"
          >
            {importError}
          </p>
        ) : null}

        <DialogFooter className="gap-3 border-t-0 bg-transparent p-0 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={formDisabled || !importDraft.trim()}
            onClick={onApply}
          >
            Apply to form
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
