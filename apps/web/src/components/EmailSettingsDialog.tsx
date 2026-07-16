import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { UpdateEmailSettingsRequest } from "@nakama/core/contract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { EmailSettingsFooter } from "@/components/email-settings-footer";
import { EmailSettingsFormFields } from "@/components/email-settings-form-fields";
import {
  emailSettingsQueryOptions,
  useSaveEmailSettings,
  useSendEmailTest,
} from "@/hooks/use-email-settings";
import { useAuth } from "@/context/use-auth";
import { formatError } from "@/lib/client";

export function EmailSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const { data: settings, isLoading, error: loadError } = useQuery({
    ...emailSettingsQueryOptions,
    enabled: open,
  });
  const saveMutation = useSaveEmailSettings();
  const testMutation = useSendEmailTest();

  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapSecure, setImapSecure] = useState(true);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [from, setFrom] = useState("");
  const [fromName, setFromName] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const passwordPlaceholder = settings?.passwordMasked
    ? `Saved (${settings.passwordMasked})`
    : "App password";

  useEffect(() => {
    if (!open) {
      setHint(null);
      setFormError(null);
      setShowPassword(false);
      return;
    }

    if (!settings) {
      return;
    }

    setImapHost(settings.imapHost ?? "");
    setImapPort(String(settings.imapPort ?? 993));
    setImapSecure(settings.imapSecure ?? true);
    setSmtpHost(settings.smtpHost ?? "");
    setSmtpPort(String(settings.smtpPort ?? 587));
    setSmtpSecure(settings.smtpSecure ?? false);
    setUsername(settings.username ?? "");
    setFrom(settings.from ?? settings.username ?? "");
    setFromName(settings.fromName ?? "");
    setPassword("");
  }, [open, settings]);

  useEffect(() => {
    if (user?.email && !testRecipient) {
      setTestRecipient(user.email);
    }
  }, [user?.email, testRecipient]);

  const handleSave = () => {
    setFormError(null);
    setHint(null);

    const request: UpdateEmailSettingsRequest = {
      imapHost: imapHost.trim(),
      imapPort: Number(imapPort),
      imapSecure,
      smtpHost: smtpHost.trim(),
      smtpPort: Number(smtpPort),
      smtpSecure,
      username: username.trim(),
      from: from.trim(),
      fromName: fromName.trim(),
      ...(password.trim() ? { password: password.trim() } : {}),
    };

    saveMutation.mutate(request, {
      onSuccess: (saved) => {
        setPassword("");
        setHint(saved.configured ? "Settings saved." : "Saved, but mailbox is not fully configured yet.");
      },
      onError: (err) => {
        setFormError(formatError(err));
      },
    });
  };

  const handleTestSend = () => {
    setFormError(null);
    setHint(null);

    testMutation.mutate(
      { to: testRecipient.trim() || undefined },
      {
        onSuccess: (result) => {
          setHint(`Test email sent to ${result.to}.`);
        },
        onError: (err) => {
          setFormError(formatError(err));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 pr-6">
            <div className="min-w-0 flex-1">
              <DialogTitle>Email mailbox</DialogTitle>
              <DialogDescription className="text-xs">
                Shared mailbox for the built-in email agent tool.
              </DialogDescription>
            </div>
            {settings?.configured ? (
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
                Configured
              </span>
            ) : null}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
            <Spinner />
            Loading email settings…
          </div>
        ) : loadError ? (
          <div className="px-4 py-4 text-sm text-destructive" role="alert">
            {formatError(loadError)}
          </div>
        ) : (
          <>
            <EmailSettingsFormFields
              fromName={fromName}
              from={from}
              username={username}
              password={password}
              showPassword={showPassword}
              passwordPlaceholder={passwordPlaceholder}
              imapHost={imapHost}
              imapPort={imapPort}
              imapSecure={imapSecure}
              smtpHost={smtpHost}
              smtpPort={smtpPort}
              smtpSecure={smtpSecure}
              onFromNameChange={setFromName}
              onFromChange={setFrom}
              onUsernameChange={setUsername}
              onPasswordChange={setPassword}
              onShowPasswordToggle={() => setShowPassword((value) => !value)}
              onImapHostChange={setImapHost}
              onImapPortChange={setImapPort}
              onImapSecureChange={setImapSecure}
              onSmtpHostChange={setSmtpHost}
              onSmtpPortChange={setSmtpPort}
              onSmtpSecureChange={setSmtpSecure}
            />

            <EmailSettingsFooter
              hint={hint}
              formError={formError}
              testRecipient={testRecipient}
              userEmail={user?.email}
              testPending={testMutation.isPending}
              savePending={saveMutation.isPending}
              configured={settings?.configured ?? false}
              onTestRecipientChange={setTestRecipient}
              onTestSend={handleTestSend}
              onSave={handleSave}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
