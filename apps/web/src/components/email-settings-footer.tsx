import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export function EmailSettingsFooter({
  hint,
  formError,
  testRecipient,
  testPending,
  savePending,
  configured,
  onTestRecipientChange,
  onTestSend,
  onSave,
}: {
  hint: string | null;
  formError: string | null;
  testRecipient: string;
  testPending: boolean;
  savePending: boolean;
  configured: boolean;
  onTestRecipientChange: (value: string) => void;
  onTestSend: () => void;
  onSave: () => void;
}) {
  return (
    <DialogFooter className="mx-0 mb-0 flex-col items-stretch gap-3 px-4 py-3 sm:flex-col">
      {hint || formError ? (
        <div className="space-y-1">
          {hint ? (
            <p className="text-xs text-emerald-200" role="status">
              {hint}
            </p>
          ) : null}
          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-2">
          <Input
            id="email-test-recipient"
            className="min-w-0 flex-1"
            value={testRecipient}
            onChange={(event) => onTestRecipientChange(event.target.value)}
            placeholder="Test recipient"
          />
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            disabled={testPending || !configured}
            onClick={onTestSend}
          >
            {testPending ? (
              <>
                <Spinner className="mr-2" />
                Sending…
              </>
            ) : (
              "Send test"
            )}
          </Button>
        </div>

        <Button type="button" className="shrink-0 sm:ml-3" disabled={savePending} onClick={onSave}>
          {savePending ? (
            <>
              <Spinner className="mr-2" />
              Saving…
            </>
          ) : (
            "Save settings"
          )}
        </Button>
      </div>
    </DialogFooter>
  );
}
