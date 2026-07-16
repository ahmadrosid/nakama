import type { ProfileSummary } from "@nakama/core/contract";
import { CopyIcon, EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  IntegrationSettingsFooter,
  IntegrationStatusHeader,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { cn } from "@/lib/utils";

export function TelegramSettingsCardContent({
  embedded,
  headerSubtitle,
  statusBadge,
  configured,
  settings,
  hasLinkedUsers,
  running,
  botToken,
  showBotToken,
  onBotTokenChange,
  onToggleShowBotToken,
  savePending,
  isPaired,
  pairingCode,
  onCopyHandshakeCode,
  onRegenerateHandshake,
  regeneratePending,
  allowedUserSummary,
  onManageAllowedUsers,
  profileId,
  profiles,
  onProfileChange,
  worker,
  statusLine,
  formError,
  loadError,
  canSave,
  submitLabel,
  onSave,
}: {
  embedded: boolean;
  headerSubtitle: string;
  statusBadge: string;
  configured: boolean;
  settings: { botTokenMasked?: string | null } | null | undefined;
  hasLinkedUsers: boolean;
  running: boolean;
  botToken: string;
  showBotToken: boolean;
  onBotTokenChange: (value: string) => void;
  onToggleShowBotToken: () => void;
  savePending: boolean;
  isPaired: boolean;
  pairingCode: string | null;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
  regeneratePending: boolean;
  allowedUserSummary: string;
  onManageAllowedUsers: () => void;
  profileId: string;
  profiles: ProfileSummary[];
  onProfileChange: (profileId: string) => void;
  worker: { process?: { managed?: boolean } } | null | undefined;
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  canSave: boolean;
  submitLabel: string;
  onSave: () => void;
}) {
  return (
    <div className="divide-y divide-border">
      {!embedded ? (
        <IntegrationStatusHeader
          title="Telegram"
          subtitle={headerSubtitle}
          statusBadge={statusBadge}
          configured={configured}
          connected={hasLinkedUsers && running}
        />
      ) : null}

      <SettingsRow label="Bot token" description="From @BotFather">
        <InputGroup className="w-full min-w-[12rem] sm:w-[16rem]">
          <InputGroupInput
            id="telegram-bot-token"
            type={showBotToken ? "text" : "password"}
            autoComplete="off"
            placeholder={
              configured && settings?.botTokenMasked
                ? `Saved (${settings.botTokenMasked})`
                : "Paste token"
            }
            value={botToken}
            disabled={savePending}
            onChange={(event) => onBotTokenChange(event.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              size="icon-xs"
              aria-label={showBotToken ? "Hide token" : "Show token"}
              onClick={onToggleShowBotToken}
            >
              {showBotToken ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </SettingsRow>

      {configured ? (
        <div className={cn("divide-y divide-border", !isPaired && "bg-muted/20")}>
          <SettingsRow
            label="Pairing code"
            description={
              isPaired
                ? "Telegram is linked. Generate a new code to link another account."
                : pairingCode
                  ? "Send this code to your bot in Telegram to finish linking."
                  : "Generate a code, then message it to your bot once."
            }
          >
            {isPaired ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={regeneratePending || savePending}
                onClick={onRegenerateHandshake}
              >
                {regeneratePending ? (
                  <Spinner />
                ) : (
                  <>
                    <RefreshCwIcon className="size-3.5" aria-hidden="true" />
                    New code
                  </>
                )}
              </Button>
            ) : pairingCode ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <code className="rounded-md border border-border bg-background px-2.5 py-1 text-sm tracking-widest">
                  {pairingCode}
                </code>
                <Button type="button" size="sm" variant="outline" onClick={onCopyHandshakeCode}>
                  <CopyIcon className="size-4" />
                  Copy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={regeneratePending || savePending}
                  onClick={onRegenerateHandshake}
                >
                  {regeneratePending ? (
                    <Spinner />
                  ) : (
                    <>
                      <RefreshCwIcon className="size-3.5" aria-hidden="true" />
                      New code
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={regeneratePending || savePending}
                onClick={onRegenerateHandshake}
              >
                {regeneratePending ? (
                  <>
                    <Spinner className="mr-2" />
                    Generating…
                  </>
                ) : (
                  "Generate pairing code"
                )}
              </Button>
            )}
          </SettingsRow>

          {!isPaired && pairingCode ? (
            <ol className="list-decimal space-y-1 px-4 py-3 pl-8 text-xs text-muted-foreground">
              <li>Open your bot in the Telegram app</li>
              <li>Paste or type the pairing code as a message</li>
              <li>For groups: link in a private chat first.</li>
              <li>
                In @BotFather, disable Group Privacy for the bot if you want @mentions to work
                reliably.
              </li>
              <li>If you changed Group Privacy, remove the bot from the group and add it back.</li>
              <li>
                Add the bot to the group, then trigger it with an @mention, a reply, or a slash
                command.
              </li>
            </ol>
          ) : null}
        </div>
      ) : null}

      {configured ? (
        <SettingsRow label="Allowed users" description="Telegram user IDs that can use this bot">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">{allowedUserSummary}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={savePending}
              onClick={onManageAllowedUsers}
            >
              Manage
            </Button>
          </div>
        </SettingsRow>
      ) : null}

      {configured ? (
        <SettingsRow label="Reply as" description="Which agent answers on Telegram">
          <Select
            value={profileId}
            disabled={savePending || profiles.length === 0}
            onValueChange={(value) => {
              if (value) {
                onProfileChange(String(value));
              }
            }}
          >
            <SelectTrigger id="telegram-profile" className="w-[11rem] sm:w-[13rem]">
              <SelectValue placeholder="Profile">
                {profiles.find((profile) => profile.id === profileId)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  <span className="flex items-center gap-2">
                    <ProfileAvatar profile={profile} size="sm" />
                    <span>{profile.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      ) : null}

      {configured ? (
        <SettingsRow label="Bridge worker" description={running ? "Running" : "Stopped"}>
          <WorkerActionBar
            workerName="telegram"
            running={running}
            pm2Managed={worker?.process?.managed ?? false}
          />
        </SettingsRow>
      ) : null}

      <IntegrationSettingsFooter
        statusLine={statusLine}
        formError={formError}
        loadError={loadError}
        savePending={savePending}
        canSave={canSave}
        submitLabel={submitLabel}
        onSave={onSave}
      />
    </div>
  );
}
