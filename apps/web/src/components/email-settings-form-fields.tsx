import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export function EmailSettingsFormFields({
  fromName,
  from,
  username,
  password,
  showPassword,
  passwordPlaceholder,
  imapHost,
  imapPort,
  imapSecure,
  smtpHost,
  smtpPort,
  smtpSecure,
  onFromNameChange,
  onFromChange,
  onUsernameChange,
  onPasswordChange,
  onShowPasswordToggle,
  onImapHostChange,
  onImapPortChange,
  onImapSecureChange,
  onSmtpHostChange,
  onSmtpPortChange,
  onSmtpSecureChange,
}: {
  fromName: string;
  from: string;
  username: string;
  password: string;
  showPassword: boolean;
  passwordPlaceholder: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  onFromNameChange: (value: string) => void;
  onFromChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onShowPasswordToggle: () => void;
  onImapHostChange: (value: string) => void;
  onImapPortChange: (value: string) => void;
  onImapSecureChange: (value: boolean) => void;
  onSmtpHostChange: (value: string) => void;
  onSmtpPortChange: (value: string) => void;
  onSmtpSecureChange: (value: boolean) => void;
}) {
  return (
    <div className="space-y-4 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField density="compact" id="email-from-name" label="From name">
          <Input
            onChange={(event) => onFromNameChange(event.target.value)}
            placeholder="Acme Support"
            value={fromName}
          />
        </FormField>

        <FormField density="compact" id="email-from" label="From address">
          <Input
            onChange={(event) => onFromChange(event.target.value)}
            placeholder={username || "user@example.com"}
            value={from}
          />
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField density="compact" id="email-username" label="Email">
          <Input
            autoComplete="username"
            onChange={(event) => onUsernameChange(event.target.value)}
            value={username}
          />
        </FormField>

        <FormField density="compact" id="email-password" label="Password">
          <div className="flex gap-2">
            <Input
              autoComplete="new-password"
              className="min-w-0 flex-1"
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={passwordPlaceholder}
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <Button
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={onShowPasswordToggle}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {showPassword ? (
                <ViewOffIcon className="size-4" />
              ) : (
                <ViewIcon className="size-4" />
              )}
            </Button>
          </div>
        </FormField>
      </div>

      <EmailImapSmtpTable
        imapHost={imapHost}
        imapPort={imapPort}
        imapSecure={imapSecure}
        onImapHostChange={onImapHostChange}
        onImapPortChange={onImapPortChange}
        onImapSecureChange={onImapSecureChange}
        onSmtpHostChange={onSmtpHostChange}
        onSmtpPortChange={onSmtpPortChange}
        onSmtpSecureChange={onSmtpSecureChange}
        smtpHost={smtpHost}
        smtpPort={smtpPort}
        smtpSecure={smtpSecure}
      />
    </div>
  );
}

function EmailImapSmtpTable({
  imapHost,
  imapPort,
  imapSecure,
  smtpHost,
  smtpPort,
  smtpSecure,
  onImapHostChange,
  onImapPortChange,
  onImapSecureChange,
  onSmtpHostChange,
  onSmtpPortChange,
  onSmtpSecureChange,
}: {
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  onImapHostChange: (value: string) => void;
  onImapPortChange: (value: string) => void;
  onImapSecureChange: (value: boolean) => void;
  onSmtpHostChange: (value: string) => void;
  onSmtpPortChange: (value: string) => void;
  onSmtpSecureChange: (value: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-border border-b bg-muted/30 text-muted-foreground text-xs">
          <tr>
            <th className="w-16 px-3 py-2 font-medium" />
            <th className="px-3 py-2 font-medium">IMAP</th>
            <th className="px-3 py-2 font-medium">SMTP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr>
            <th
              className="px-3 py-2 font-medium text-muted-foreground text-xs"
              scope="row"
            >
              Host
            </th>
            <td className="px-3 py-2">
              <Input
                id="email-imap-host"
                onChange={(event) => onImapHostChange(event.target.value)}
                placeholder="imap.gmail.com"
                value={imapHost}
              />
            </td>
            <td className="px-3 py-2">
              <Input
                id="email-smtp-host"
                onChange={(event) => onSmtpHostChange(event.target.value)}
                placeholder="smtp.gmail.com"
                value={smtpHost}
              />
            </td>
          </tr>
          <tr>
            <th
              className="px-3 py-2 font-medium text-muted-foreground text-xs"
              scope="row"
            >
              Port
            </th>
            <td className="px-3 py-2">
              <Input
                className="w-24"
                id="email-imap-port"
                inputMode="numeric"
                onChange={(event) => onImapPortChange(event.target.value)}
                value={imapPort}
              />
            </td>
            <td className="px-3 py-2">
              <Input
                className="w-24"
                id="email-smtp-port"
                inputMode="numeric"
                onChange={(event) => onSmtpPortChange(event.target.value)}
                value={smtpPort}
              />
            </td>
          </tr>
          <tr>
            <th
              className="px-3 py-2 font-medium text-muted-foreground text-xs"
              scope="row"
            >
              TLS
            </th>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={imapSecure}
                  id="email-imap-secure"
                  onCheckedChange={onImapSecureChange}
                />
                <label
                  className="text-muted-foreground text-xs"
                  htmlFor="email-imap-secure"
                >
                  Enabled
                </label>
              </div>
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={smtpSecure}
                  id="email-smtp-secure"
                  onCheckedChange={onSmtpSecureChange}
                />
                <label
                  className="text-muted-foreground text-xs"
                  htmlFor="email-smtp-secure"
                >
                  Enabled
                </label>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
