import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { UpdateEmailSettingsRequest } from "@nakama/core/contract";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  emailSettingsQueryOptions,
  useSaveEmailSettings,
  useSendEmailTest,
} from "@/hooks/use-email-settings";
import { useAuth } from "@/context/auth-context";
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
            <div className="space-y-4 px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="email-from-name" label="From name" density="compact">
                  <Input
                    value={fromName}
                    onChange={(event) => setFromName(event.target.value)}
                    placeholder="Acme Support"
                  />
                </FormField>

                <FormField id="email-from" label="From address" density="compact">
                  <Input
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    placeholder={username || "user@example.com"}
                  />
                </FormField>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="email-username" label="Email" density="compact">
                  <Input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                  />
                </FormField>

                <FormField id="email-password" label="Password" density="compact">
                  <div className="flex gap-2">
                    <Input
                      className="min-w-0 flex-1"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={passwordPlaceholder}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                    </Button>
                  </div>
                </FormField>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="w-16 px-3 py-2 font-medium" />
                      <th className="px-3 py-2 font-medium">IMAP</th>
                      <th className="px-3 py-2 font-medium">SMTP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <th
                        scope="row"
                        className="px-3 py-2 text-xs font-medium text-muted-foreground"
                      >
                        Host
                      </th>
                      <td className="px-3 py-2">
                        <Input
                          id="email-imap-host"
                          value={imapHost}
                          onChange={(event) => setImapHost(event.target.value)}
                          placeholder="imap.gmail.com"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          id="email-smtp-host"
                          value={smtpHost}
                          onChange={(event) => setSmtpHost(event.target.value)}
                          placeholder="smtp.gmail.com"
                        />
                      </td>
                    </tr>
                    <tr>
                      <th
                        scope="row"
                        className="px-3 py-2 text-xs font-medium text-muted-foreground"
                      >
                        Port
                      </th>
                      <td className="px-3 py-2">
                        <Input
                          id="email-imap-port"
                          className="w-24"
                          value={imapPort}
                          onChange={(event) => setImapPort(event.target.value)}
                          inputMode="numeric"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          id="email-smtp-port"
                          className="w-24"
                          value={smtpPort}
                          onChange={(event) => setSmtpPort(event.target.value)}
                          inputMode="numeric"
                        />
                      </td>
                    </tr>
                    <tr>
                      <th
                        scope="row"
                        className="px-3 py-2 text-xs font-medium text-muted-foreground"
                      >
                        TLS
                      </th>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            id="email-imap-secure"
                            checked={imapSecure}
                            onCheckedChange={setImapSecure}
                          />
                          <label htmlFor="email-imap-secure" className="text-xs text-muted-foreground">
                            Enabled
                          </label>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            id="email-smtp-secure"
                            checked={smtpSecure}
                            onCheckedChange={setSmtpSecure}
                          />
                          <label htmlFor="email-smtp-secure" className="text-xs text-muted-foreground">
                            Enabled
                          </label>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

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
                    onChange={(event) => setTestRecipient(event.target.value)}
                    placeholder={user?.email ?? "Test recipient"}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    disabled={testMutation.isPending || !settings?.configured}
                    onClick={handleTestSend}
                  >
                    {testMutation.isPending ? (
                      <>
                        <Spinner className="mr-2" />
                        Sending…
                      </>
                    ) : (
                      "Send test"
                    )}
                  </Button>
                </div>

                <Button
                  type="button"
                  className="shrink-0 sm:ml-3"
                  disabled={saveMutation.isPending}
                  onClick={handleSave}
                >
                  {saveMutation.isPending ? (
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
