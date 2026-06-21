import { useEffect, useState, type ReactNode } from "react";
import type { UpdateEmailSettingsRequest } from "@tinyclaw/core/contract";
import { EyeIcon, EyeOffIcon, MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  useEmailSettings,
  useSaveEmailSettings,
  useSendEmailTest,
} from "@/hooks/use-email-settings";
import { useAuth } from "@/context/auth-context";
import { formatError } from "@/lib/client";

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function EmailSettingsCard() {
  const { user } = useAuth();
  const { data: settings, isLoading, error: loadError } = useEmailSettings();
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
  const [testRecipient, setTestRecipient] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
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
    setPassword("");
  }, [settings]);

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
      ...(password.trim() ? { password: password.trim() } : {}),
    };

    saveMutation.mutate(request, {
      onSuccess: (saved) => {
        setPassword("");
        setHint(saved.configured ? "Email settings saved." : "Saved, but mailbox is not fully configured yet.");
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

  if (isLoading) {
    return (
      <Card className="w-full shadow-none">
        <CardContent className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          <Spinner />
          Loading email settings…
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="w-full shadow-none">
        <CardContent className="px-4 py-6 text-sm text-destructive" role="alert">
          {formatError(loadError)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full shadow-none">
      <CardContent className="divide-y divide-border p-0">
        <div className="flex items-center gap-2 px-4 py-3">
          <MailIcon className="size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Email</p>
            <p className="text-xs text-muted-foreground">
              Shared mailbox for the built-in email agent tool. Gmail typically uses imap.gmail.com:993
              and smtp.gmail.com:587 with an app password.
            </p>
          </div>
          {settings?.configured ? (
            <span className="ml-auto rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
              Configured
            </span>
          ) : null}
        </div>

        <SettingsRow label="Username" description="Mailbox login">
          <Input
            className="w-64"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />
        </SettingsRow>

        <SettingsRow
          label="Password"
          description={
            settings?.passwordMasked
              ? `Saved as ${settings.passwordMasked}. Leave blank to keep it.`
              : "App password or mailbox secret"
          }
        >
          <div className="flex items-center gap-2">
            <Input
              className="w-64"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
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
        </SettingsRow>

        <SettingsRow label="IMAP host">
          <Input
            className="w-64"
            value={imapHost}
            onChange={(event) => setImapHost(event.target.value)}
            placeholder="imap.example.com"
          />
        </SettingsRow>

        <SettingsRow label="IMAP port">
          <Input
            className="w-24"
            value={imapPort}
            onChange={(event) => setImapPort(event.target.value)}
            inputMode="numeric"
          />
        </SettingsRow>

        <SettingsRow label="IMAP TLS" description="Use implicit TLS (port 993)">
          <Switch checked={imapSecure} onCheckedChange={setImapSecure} />
        </SettingsRow>

        <SettingsRow label="SMTP host">
          <Input
            className="w-64"
            value={smtpHost}
            onChange={(event) => setSmtpHost(event.target.value)}
            placeholder="smtp.example.com"
          />
        </SettingsRow>

        <SettingsRow label="SMTP port">
          <Input
            className="w-24"
            value={smtpPort}
            onChange={(event) => setSmtpPort(event.target.value)}
            inputMode="numeric"
          />
        </SettingsRow>

        <SettingsRow label="SMTP TLS" description="Use implicit TLS (port 465)">
          <Switch checked={smtpSecure} onCheckedChange={setSmtpSecure} />
        </SettingsRow>

        <SettingsRow label="From address" description="Defaults to username when empty">
          <Input
            className="w-64"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            placeholder={username || "user@example.com"}
          />
        </SettingsRow>

        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={saveMutation.isPending} onClick={handleSave}>
              {saveMutation.isPending ? (
                <>
                  <Spinner className="mr-2" />
                  Saving…
                </>
              ) : (
                "Save email settings"
              )}
            </Button>
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-foreground">Send test email</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="email-test-recipient"
                className="w-64"
                value={testRecipient}
                onChange={(event) => setTestRecipient(event.target.value)}
                placeholder={user?.email ?? "you@example.com"}
              />
              <Button
                type="button"
                variant="secondary"
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
          </div>

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
      </CardContent>
    </Card>
  );
}
