import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function CodingHarnessSettingsFooter({
  verifyPending,
  savePending,
  selectedHarnessId,
  onRefresh,
  onVerify,
  onSave,
}: {
  verifyPending: boolean;
  savePending: boolean;
  selectedHarnessId: string | null;
  onRefresh: () => void;
  onVerify: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">
        Nakama should only enable code delegation after the selected agent is ready.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={onRefresh}>
          Check again
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onVerify}
          disabled={verifyPending || !selectedHarnessId}
        >
          {verifyPending ? <Spinner className="size-4" /> : "Run readiness check"}
        </Button>
        <Button type="button" onClick={onSave} disabled={savePending || !selectedHarnessId}>
          {savePending ? <Spinner className="size-4" /> : "Save selected agent"}
        </Button>
      </div>
    </div>
  );
}
