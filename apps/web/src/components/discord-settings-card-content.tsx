import type { ProfileSummary } from "@nakama/core/contract";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";
import type { AllowedDiscordUser } from "@/components/DiscordAllowedUsersDialog";
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
import { DISCORD_DEVELOPER_PORTAL_URL, DISCORD_SETUP_GUIDE_URL } from "@/lib/integration-docs";
import { cn } from "@/lib/utils";
import { DiscordPairingGuide, SettingsRow } from "@/components/discord-settings-card.shared";

export function DiscordSettingsCardContent({
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
  copied,
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
  settings: {
    botTokenMasked?: string | null;
    inviteUrl?: string | null;
  } | null | undefined;
  hasLinkedUsers: boolean;
  running: boolean;
  botToken: string;
  showBotToken: boolean;
  onBotTokenChange: (value: string) => void;
  onToggleShowBotToken: () => void;
  savePending: boolean;
  isPaired: boolean;
  pairingCode: string | null;
  copied: boolean;
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
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">Discord</p>
            <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium",
              hasLinkedUsers && running
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                : configured
                  ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100"
                  : "border-border bg-muted text-muted-foreground",
            )}
          >
            {statusBadge}
          </span>
        </div>
      ) : null}

      <SettingsRow
        layout="stacked"
        label="Bot token"
        description={
          <>
            Create a bot in the{" "}
            <a
              href={DISCORD_DEVELOPER_PORTAL_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Discord Developer Portal
            </a>
            . Follow the{" "}
            <a
              href={DISCORD_SETUP_GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              setup guide
            </a>{" "}
            for token, intents, and invite steps.
          </>
        }
      >
        <InputGroup className="w-full">
          <InputGroupInput
            id="discord-bot-token"
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
                ? "Discord is linked. Generate a new code to link another account."
                : pairingCode
                  ? "Send this code to your bot in Discord to finish linking."
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-w-[5.25rem] justify-center"
                  onClick={onCopyHandshakeCode}
                >
                  {copied ? (
                    <CheckIcon
                      className="size-3.5 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <CopyIcon className="size-3.5" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
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
            <DiscordPairingGuide inviteUrl={settings?.inviteUrl ?? null} />
          ) : null}
        </div>
      ) : null}

      {configured ? (
        <SettingsRow label="Allowed users" description="Discord user IDs that can use this bot">
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
        <SettingsRow label="Reply as" description="Which agent answers on Discord">
          <Select
            value={profileId}
            disabled={savePending || profiles.length === 0}
            onValueChange={(value) => {
              if (value) {
                onProfileChange(String(value));
              }
            }}
          >
            <SelectTrigger id="discord-profile" className="w-[11rem] sm:w-[13rem]">
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
            workerName="discord"
            running={running}
            pm2Managed={worker?.process?.managed ?? false}
          />
        </SettingsRow>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        {statusLine ? (
          <p
            className={cn(
              "min-w-0 text-xs",
              formError || loadError ? "text-destructive" : "text-emerald-200",
            )}
            role={formError || loadError ? "alert" : "status"}
          >
            {statusLine}
          </p>
        ) : (
          <span />
        )}
        <Button type="button" size="sm" disabled={savePending || !canSave} onClick={onSave}>
          {savePending ? (
            <>
              <Spinner className="mr-2" />
              Saving…
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </div>
  );
}
