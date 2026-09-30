import type { PasskeyCredentialResponse } from "@nakama/core/contract";
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
import { createPasskey, getPasskey } from "@/lib/passkey";

type BackupCodeMethod = "mfa" | "passkey";
type MfaUser = ReturnType<typeof useAuth>["user"];

function MfaSettingsContent({
  actions,
  state,
}: {
  actions: {
    cancelTotpSetup: () => void;
    openBackupCodeDialog: () => void;
    setCode: (value: string) => void;
    setDisableConfirmOpen: (value: boolean) => void;
    setDisablePasskeyBackupCode: (value: string) => void;
    setDisablePasskeyDialogOpen: (value: boolean) => void;
    setError: (value: string | null) => void;
    startPasskey: () => void;
    startTotp: () => void;
    verifyTotp: () => void;
  };
  state: {
    backupCodes: string[];
    busy: boolean;
    code: string;
    error: string | null;
    totpUri: string | null;
    user: MfaUser;
  };
}) {
  const {
    cancelTotpSetup,
    openBackupCodeDialog,
    setCode,
    setDisableConfirmOpen,
    setDisablePasskeyBackupCode,
    setDisablePasskeyDialogOpen,
    setError,
    startPasskey,
    startTotp,
    verifyTotp,
  } = actions;
  const { backupCodes, busy, code, error, totpUri, user } = state;

  return (
    <CardContent className="p-0">
      <div className="border-border border-b px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-foreground text-sm">
              Multi Factor Authentication
            </p>
            <p className="text-muted-foreground text-xs">
              Choose a passkey or authenticator app to protect this account.
            </p>
          </div>
          <span className="shrink-0 text-muted-foreground text-xs">
            {user?.passkeyEnabled || user?.mfaEnabled
              ? "Enabled"
              : "Not enrolled"}
          </span>
        </div>
      </div>
      <div className="border-border border-b px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Passkey</p>
            <p className="text-muted-foreground text-xs">
              Use iCloud Keychain or another security key as your MFA method.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {user?.passkeyEnabled ? (
              <Button
                disabled={busy}
                onClick={() => {
                  setDisablePasskeyBackupCode("");
                  setError(null);
                  setDisablePasskeyDialogOpen(true);
                }}
                type="button"
                variant="outline"
              >
                Disable passkey
              </Button>
            ) : (
              <Button disabled={busy} onClick={startPasskey} type="button">
                Add passkey
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-4 px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Authenticator app</p>
            <p className="text-muted-foreground text-xs">
              Use an authenticator app to generate verification codes.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {!totpUri &&
              (user?.mfaEnabled ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setDisableConfirmOpen(true);
                  }}
                  type="button"
                  variant="outline"
                >
                  Disable authenticator
                </Button>
              ) : (
                <Button disabled={busy} onClick={startTotp} type="button">
                  Add authenticator
                </Button>
              ))}
          </div>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
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
        {totpUri ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={busy || code.trim().length < 6}
              onClick={verifyTotp}
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
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-4 border-border border-t pt-4">
          <div>
            <p className="font-medium text-sm">Backup codes</p>
            <p className="text-muted-foreground text-xs">
              Codes are shown only when generated. Regenerate them if you no
              longer have them.
            </p>
          </div>
          <Button
            disabled={busy || !(user?.passkeyEnabled || user?.mfaEnabled)}
            onClick={openBackupCodeDialog}
            type="button"
            variant="outline"
          >
            {user?.backupCodesEnabled ? "Regenerate codes" : "Generate codes"}
          </Button>
        </div>
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
      </div>
    </CardContent>
  );
}

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

function MfaActionDialogs({
  actions,
  state,
}: {
  actions: {
    disableMfa: () => Promise<void>;
    disablePasskeyWithBackupCode: () => Promise<void>;
    disablePasskeyWithPasskey: () => Promise<void>;
    generateBackupCodes: () => Promise<void>;
    setBackupCodeDialogOpen: (value: boolean) => void;
    setBackupCodeInput: (value: string) => void;
    setBackupCodeMethod: (value: BackupCodeMethod) => void;
    setDisableBackupCode: (value: string) => void;
    setDisableCode: (value: string) => void;
    setDisableConfirmOpen: (value: boolean) => void;
    setDisableMethod: (value: "totp" | "backup") => void;
    setDisablePasskeyBackupCode: (value: string) => void;
    setDisablePasskeyDialogOpen: (value: boolean) => void;
    setDisableVerifyOpen: (value: boolean) => void;
    setError: (value: string | null) => void;
  };
  state: {
    backupCodeDialogOpen: boolean;
    backupCodeInput: string;
    backupCodeMethod: BackupCodeMethod;
    busy: boolean;
    disableBackupCode: string;
    disableCode: string;
    disableConfirmOpen: boolean;
    disableMethod: "totp" | "backup";
    disablePasskeyBackupCode: string;
    disablePasskeyDialogOpen: boolean;
    disableVerifyOpen: boolean;
    error: string | null;
    user: MfaUser;
  };
}) {
  const {
    disableMfa,
    disablePasskeyWithBackupCode,
    disablePasskeyWithPasskey,
    generateBackupCodes,
    setBackupCodeDialogOpen,
    setBackupCodeInput,
    setBackupCodeMethod,
    setDisableBackupCode,
    setDisableCode,
    setDisableConfirmOpen,
    setDisableMethod,
    setDisablePasskeyBackupCode,
    setDisablePasskeyDialogOpen,
    setDisableVerifyOpen,
    setError,
  } = actions;
  const {
    backupCodeDialogOpen,
    backupCodeInput,
    backupCodeMethod,
    busy,
    disableBackupCode,
    disableCode,
    disableConfirmOpen,
    disableMethod,
    disablePasskeyBackupCode,
    disablePasskeyDialogOpen,
    disableVerifyOpen,
    error,
    user,
  } = state;

  return (
    <>
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
      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setDisablePasskeyDialogOpen(false);
            setDisablePasskeyBackupCode("");
            setError(null);
          }
        }}
        open={disablePasskeyDialogOpen}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Disable passkey?</DialogTitle>
            <DialogDescription>
              Confirm with your passkey or an unused backup code.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => void disablePasskeyWithPasskey()}
            type="button"
            variant="outline"
          >
            Use passkey
          </Button>
          <div className="space-y-2">
            <label
              className="block font-medium text-sm"
              htmlFor="disable-passkey-backup-code"
            >
              Backup code
            </label>
            <Input
              autoComplete="off"
              id="disable-passkey-backup-code"
              onChange={(event) =>
                setDisablePasskeyBackupCode(event.target.value)
              }
              placeholder="Enter a backup code"
              value={disablePasskeyBackupCode}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => {
                setDisablePasskeyDialogOpen(false);
                setDisablePasskeyBackupCode("");
                setError(null);
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy || disablePasskeyBackupCode.trim().length === 0}
              onClick={() => void disablePasskeyWithBackupCode()}
              type="button"
              variant="destructive"
            >
              Disable passkey
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!(open || busy)) {
            setBackupCodeDialogOpen(false);
            setBackupCodeInput("");
            setError(null);
          }
        }}
        open={backupCodeDialogOpen}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {user?.backupCodesEnabled
                ? "Regenerate backup codes?"
                : "Generate backup codes"}
            </DialogTitle>
            <DialogDescription>
              Regenerating codes invalidates every existing backup code.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          {backupCodeMethod === "passkey" ? (
            <p className="text-muted-foreground text-sm">
              Approve your passkey to continue.
            </p>
          ) : (
            <>
              <label
                className="block font-medium text-sm"
                htmlFor="backup-mfa-code"
              >
                Authenticator code
              </label>
              <MfaCodeInput
                id="backup-mfa-code"
                onChange={setBackupCodeInput}
                value={backupCodeInput}
              />
            </>
          )}
          {user?.passkeyEnabled && user.mfaEnabled ? (
            <Button
              className="w-fit px-0"
              disabled={busy}
              onClick={() => {
                setBackupCodeMethod(
                  backupCodeMethod === "passkey" ? "mfa" : "passkey"
                );
                setBackupCodeInput("");
                setError(null);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {backupCodeMethod === "passkey"
                ? "Use authenticator code instead"
                : "Use passkey instead"}
            </Button>
          ) : null}
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => {
                setBackupCodeDialogOpen(false);
                setBackupCodeInput("");
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
                (backupCodeMethod !== "passkey" &&
                  backupCodeInput.trim().length === 0)
              }
              onClick={() => void generateBackupCodes()}
              type="button"
            >
              Generate codes
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
  const [disablePasskeyDialogOpen, setDisablePasskeyDialogOpen] =
    useState(false);
  const [disablePasskeyBackupCode, setDisablePasskeyBackupCode] = useState("");
  const [available, setAvailable] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableBackupCode, setDisableBackupCode] = useState("");
  const [disableMethod, setDisableMethod] = useState<"totp" | "backup">("totp");
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [disableVerifyOpen, setDisableVerifyOpen] = useState(false);
  const [backupCodeDialogOpen, setBackupCodeDialogOpen] = useState(false);
  const [backupCodeInput, setBackupCodeInput] = useState("");
  const [backupCodeMethod, setBackupCodeMethod] =
    useState<BackupCodeMethod>("passkey");

  useEffect(() => {
    client
      .getMfaPolicy()
      .then((policy) => setAvailable(policy.enabled))
      .catch(() => setAvailable(false));
  }, []);

  function openBackupCodeDialog() {
    if (!(user?.passkeyEnabled || user?.mfaEnabled)) {
      return;
    }
    setBackupCodeInput("");
    setBackupCodeMethod(user.passkeyEnabled ? "passkey" : "mfa");
    setError(null);
    setBackupCodeDialogOpen(true);
  }

  async function generateBackupCodes() {
    setBusy(true);
    setError(null);
    try {
      let input:
        | { mfaCode: string }
        | {
            passkey: PasskeyCredentialResponse;
            passkeyChallenge: string;
          };
      if (backupCodeMethod === "passkey") {
        if (!user?.email) {
          return;
        }
        const result = await client.getPasskeyLoginOptions();
        input = {
          passkey: await getPasskey(result.options),
          passkeyChallenge: result.challenge,
        };
      } else {
        input = { mfaCode: backupCodeInput.trim() };
      }
      const result = await client.generateBackupCodes(input);
      setBackupCodes(result.backupCodes);
      setBackupCodeInput("");
      setBackupCodeDialogOpen(false);
      await refreshSession();
      toast("Backup codes generated. Save them now.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function startPasskey() {
    setBusy(true);
    setError(null);
    try {
      const result = await client.startPasskey();
      const credential = await createPasskey(result.options);
      const verification = await client.verifyPasskey(
        result.challenge,
        credential
      );
      if (verification.backupCodes.length > 0) {
        setBackupCodes(verification.backupCodes);
      }
      await refreshSession();
      toast(
        verification.backupCodes.length > 0
          ? "Passkey enabled. Save these backup codes now."
          : "Passkey enabled. Existing backup codes were kept."
      );
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function disablePasskeyWithPasskey() {
    setBusy(true);
    setError(null);
    try {
      const result = await client.getPasskeyLoginOptions();
      const credential = await getPasskey(result.options);
      await client.disablePasskey({
        challenge: result.challenge,
        credential,
      });
      await refreshSession();
      setDisablePasskeyDialogOpen(false);
      setDisablePasskeyBackupCode("");
      toast("Passkey disabled.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function disablePasskeyWithBackupCode() {
    setBusy(true);
    setError(null);
    try {
      await client.disablePasskey({
        backupCode: disablePasskeyBackupCode.trim(),
      });
      await refreshSession();
      setDisablePasskeyDialogOpen(false);
      setDisablePasskeyBackupCode("");
      toast("Passkey disabled.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }
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
        result.backupCodes.length > 0
          ? "Authenticator enabled. Save these backup codes now."
          : "Authenticator enabled."
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
      toast("Authenticator disabled.");
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
      <MfaSettingsContent
        actions={{
          cancelTotpSetup,
          openBackupCodeDialog,
          setCode,
          setDisableConfirmOpen,
          setDisablePasskeyBackupCode,
          setDisablePasskeyDialogOpen,
          setError,
          startPasskey,
          startTotp,
          verifyTotp,
        }}
        state={{ backupCodes, busy, code, error, totpUri, user }}
      />
      <MfaActionDialogs
        actions={{
          disableMfa,
          disablePasskeyWithBackupCode,
          disablePasskeyWithPasskey,
          generateBackupCodes,
          setBackupCodeDialogOpen,
          setBackupCodeInput,
          setBackupCodeMethod,
          setDisableBackupCode,
          setDisableCode,
          setDisableConfirmOpen,
          setDisableMethod,
          setDisablePasskeyBackupCode,
          setDisablePasskeyDialogOpen,
          setDisableVerifyOpen,
          setError,
        }}
        state={{
          backupCodeDialogOpen,
          backupCodeInput,
          backupCodeMethod,
          busy,
          disableBackupCode,
          disableCode,
          disableConfirmOpen,
          disableMethod,
          disablePasskeyBackupCode,
          disablePasskeyDialogOpen,
          disableVerifyOpen,
          error,
          user,
        }}
      />
    </Card>
  );
}
