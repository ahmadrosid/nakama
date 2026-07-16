import { EyeIcon, EyeOffIcon } from "lucide-react";
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
        <FormField id="email-from-name" label="From name" density="compact">
          <Input
            value={fromName}
            onChange={(event) => onFromNameChange(event.target.value)}
            placeholder="Acme Support"
          />
        </FormField>

        <FormField id="email-from" label="From address" density="compact">
          <Input
            value={from}
            onChange={(event) => onFromChange(event.target.value)}
            placeholder={username || "user@example.com"}
          />
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="email-username" label="Email" density="compact">
          <Input
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            autoComplete="username"
          />
        </FormField>

        <FormField id="email-password" label="Password" density="compact">
          <div className="flex gap-2">
            <Input
              className="min-w-0 flex-1"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              autoComplete="new-password"
              placeholder={passwordPlaceholder}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onShowPasswordToggle}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </Button>
          </div>
        </FormField>
      </div>

      <EmailImapSmtpTable
        imapHost={imapHost}
        imapPort={imapPort}
        imapSecure={imapSecure}
        smtpHost={smtpHost}
        smtpPort={smtpPort}
        smtpSecure={smtpSecure}
        onImapHostChange={onImapHostChange}
        onImapPortChange={onImapPortChange}
        onImapSecureChange={onImapSecureChange}
        onSmtpHostChange={onSmtpHostChange}
        onSmtpPortChange={onSmtpPortChange}
        onSmtpSecureChange={onSmtpSecureChange}
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
        <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <th className="w-16 px-3 py-2 font-medium" />
            <th className="px-3 py-2 font-medium">IMAP</th>
            <th className="px-3 py-2 font-medium">SMTP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr>
            <th scope="row" className="px-3 py-2 text-xs font-medium text-muted-foreground">
              Host
            </th>
            <td className="px-3 py-2">
              <Input
                id="email-imap-host"
                value={imapHost}
                onChange={(event) => onImapHostChange(event.target.value)}
                placeholder="imap.gmail.com"
              />
            </td>
            <td className="px-3 py-2">
              <Input
                id="email-smtp-host"
                value={smtpHost}
                onChange={(event) => onSmtpHostChange(event.target.value)}
                placeholder="smtp.gmail.com"
              />
            </td>
          </tr>
          <tr>
            <th scope="row" className="px-3 py-2 text-xs font-medium text-muted-foreground">
              Port
            </th>
            <td className="px-3 py-2">
              <Input
                id="email-imap-port"
                className="w-24"
                value={imapPort}
                onChange={(event) => onImapPortChange(event.target.value)}
                inputMode="numeric"
              />
            </td>
            <td className="px-3 py-2">
              <Input
                id="email-smtp-port"
                className="w-24"
                value={smtpPort}
                onChange={(event) => onSmtpPortChange(event.target.value)}
                inputMode="numeric"
              />
            </td>
          </tr>
          <tr>
            <th scope="row" className="px-3 py-2 text-xs font-medium text-muted-foreground">
              TLS
            </th>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="email-imap-secure"
                  checked={imapSecure}
                  onCheckedChange={onImapSecureChange}
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
                  onCheckedChange={onSmtpSecureChange}
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
  );
}
