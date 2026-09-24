import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { toast } from "@nakama/ui/toast";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { MfaCodeInput } from "@/components/MfaCodeInput";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";

function DisableMfaDialogs({
  busy,
  disableBackupCode,
  disableCode,
  disableConfirmOpen,
  disableMethod,
  disableMfa,
  disableVerifyOpen,
  error,
  setDisableBackupCode,
  setDisableCode,
  setDisableConfirmOpen,
  setDisableMethod,
  setDisableVerifyOpen,
  setError,
}: {
  busy: boolean;
  disableBackupCode: string;
  disableCode: string;
  disableConfirmOpen: boolean;
  disableMethod: "totp" | "backup";
  disableMfa: () => Promise<void>;
  disableVerifyOpen: boolean;
  error: string | null;
  setDisableBackupCode: (value: string) => void;
  setDisableCode: (value: string) => void;
  setDisableConfirmOpen: (value: boolean) => void;
  setDisableMethod: (value: "totp" | "backup") => void;
  setDisableVerifyOpen: (value: boolean) => void;
  setError: (value: string | null) => void;
}) {
  return (
    <>
      {disableConfirmOpen ? (
        <ConfirmDialog
          confirmLabel="Continue"
          description="Disabling multi-factor authentication removes the extra sign-in protection from this account. You will need to set it up again before using an authenticator. Continue?"
          onClose={() => setDisableConfirmOpen(false)}
          onConfirm={async () => {
            setError(null);
            setDisableVerifyOpen(true);
          }}
          title="Disable multi-factor authentication?"
        />
      ) : null}
      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setDisableVerifyOpen(false);
            setDisableCode("");
            setDisableBackupCode("");
            setDisableMethod("totp");
            setError(null);
          }
        }}
        open={disableVerifyOpen}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Verify your identity</DialogTitle>
            <DialogDescription>
              {disableMethod === "totp"
                ? "Enter the 6-digit code from your authenticator app to confirm disabling multi-factor authentication."
                : "Enter an unused backup code to confirm disabling multi-factor authentication. The code will be consumed if it is valid."}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          {disableMethod === "totp" ? (
            <>
              <label
                className="block font-medium text-sm"
                htmlFor="disable-mfa-code"
              >
                Authenticator code
              </label>
              <MfaCodeInput
                id="disable-mfa-code"
                onChange={setDisableCode}
                value={disableCode}
              />
            </>
          ) : (
            <>
              <label
                className="block font-medium text-sm"
                htmlFor="disable-mfa-backup-code"
              >
                Backup code
              </label>
              <Input
                autoComplete="off"
                id="disable-mfa-backup-code"
                onChange={(event) => setDisableBackupCode(event.target.value)}
                placeholder="Enter a backup code"
                value={disableBackupCode}
              />
            </>
          )}
          <Button
            className="w-fit px-0"
            disabled={busy}
            onClick={() => {
              setDisableMethod(disableMethod === "totp" ? "backup" : "totp");
              setDisableCode("");
              setDisableBackupCode("");
              setError(null);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {disableMethod === "totp"
              ? "Use a backup code instead"
              : "Use an authenticator code instead"}
          </Button>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => {
                setDisableVerifyOpen(false);
                setDisableCode("");
                setDisableBackupCode("");
                setDisableMethod("totp");
                setError(null);
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                (disableMethod === "totp"
                  ? disableCode.trim().length < 6
                  : disableBackupCode.trim().length === 0)
              }
              onClick={() => void disableMfa()}
              type="button"
              variant="destructive"
            >
              Disable MFA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MfaSettingsCard() {
  const { user, refreshSession } = useAuth();
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableBackupCode, setDisableBackupCode] = useState("");
  const [disableMethod, setDisableMethod] = useState<"totp" | "backup">("totp");
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [disableVerifyOpen, setDisableVerifyOpen] = useState(false);

  useEffect(() => {
    client
      .getMfaPolicy()
      .then((policy) => setAvailable(policy.enabled))
      .catch(() => setAvailable(false));
  }, []);

  if (!available) {
    return null;
  }

  async function startTotp() {
    setBusy(true);
    setError(null);
    try {
      const result = await client.startTotp();
      setTotpUri(result.uri);
      setBackupCodes([]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyTotp() {
    setBusy(true);
    setError(null);
    try {
      const result = await client.verifyTotp(code.trim());
      setBackupCodes(result.backupCodes);
      setTotpUri(null);
      setCode("");
      await refreshSession();
      toast(
        "Multi-factor authentication enabled. Save these backup codes now."
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa() {
    setBusy(true);
    setError(null);
    try {
      await client.disableMfa(
        disableMethod === "totp"
          ? { code: disableCode.trim() }
          : { backupCode: disableBackupCode.trim() }
      );
      setBackupCodes([]);
      setDisableVerifyOpen(false);
      setDisableCode("");
      setDisableBackupCode("");
      setDisableMethod("totp");
      await refreshSession();
      toast("Multi-factor authentication disabled.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }
  function cancelTotpSetup() {
    setTotpUri(null);
    setCode("");
    setError(null);
  }

  return (
    <Card className="w-full overflow-hidden shadow-none">
      <CardContent className="p-0">
        <div className="border-border border-b px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-foreground text-sm">
                Multi Factor Authentication
              </p>
              <p className="text-muted-foreground text-xs">
                Use an authenticator app to protect this account.
              </p>
            </div>
            <span className="shrink-0 text-muted-foreground text-xs">
              {user?.mfaEnabled ? "Enabled" : "Not enrolled"}
            </span>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}

          {backupCodes.length > 0 ? (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
              <p className="font-medium text-sm">Backup codes</p>
              <p className="text-muted-foreground text-xs">
                Each code works once. Save them before leaving this page.
              </p>
              <code className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
                {backupCodes.map((backupCode) => (
                  <span key={backupCode}>{backupCode}</span>
                ))}
              </code>
            </div>
          ) : null}

          {totpUri ? (
            <div className="space-y-3">
              <p className="font-medium text-sm">
                Scan with your authenticator app
              </p>
              <div className="flex flex-col items-center gap-2 p-2">
                <span className="rounded-full bg-zinc-800 px-3 py-1 font-semibold text-[10px] text-white uppercase tracking-wider">
                  Scan me
                </span>
                <div className="rounded-2xl border-4 border-zinc-800 bg-white p-3 shadow-[0_4px_0_#27272a]">
                  <QRCodeSVG
                    aria-label="Authenticator QR code"
                    bgColor="#ffffff"
                    fgColor="#27272a"
                    size={180}
                    value={totpUri}
                  />
                </div>
              </div>
              <label className="block font-medium text-sm" htmlFor="mfa-code">
                Enter the 6-digit code
              </label>
              <MfaCodeInput id="mfa-code" onChange={setCode} value={code} />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {user?.mfaEnabled ? (
              <Button
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setDisableConfirmOpen(true);
                }}
                type="button"
                variant="outline"
              >
                Disable multi-factor authentication
              </Button>
            ) : totpUri ? (
              <>
                <Button
                  disabled={busy || code.trim().length < 6}
                  onClick={() => void verifyTotp()}
                  type="button"
                >
                  Verify and enable
                </Button>
                <Button
                  disabled={busy}
                  onClick={cancelTotpSetup}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                disabled={busy}
                onClick={() => void startTotp()}
                type="button"
              >
                Add authenticator
              </Button>
            )}
          </div>
        </div>
      </CardContent>
      <DisableMfaDialogs
        busy={busy}
        disableBackupCode={disableBackupCode}
        disableCode={disableCode}
        disableConfirmOpen={disableConfirmOpen}
        disableMethod={disableMethod}
        disableMfa={disableMfa}
        disableVerifyOpen={disableVerifyOpen}
        error={error}
        setDisableBackupCode={setDisableBackupCode}
        setDisableCode={setDisableCode}
        setDisableConfirmOpen={setDisableConfirmOpen}
        setDisableMethod={setDisableMethod}
        setDisableVerifyOpen={setDisableVerifyOpen}
        setError={setError}
      />
    </Card>
  );
}
