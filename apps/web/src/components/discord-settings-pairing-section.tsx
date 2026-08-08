import type { ProfileSummary } from "@nakama/core/contract";
import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import {
  DiscordPairingGuide,
  SettingsRow,
} from "@/components/discord-settings-card.shared";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { cn } from "@/lib/utils";

export function DiscordSettingsPairingSection({
  isPaired,
  pairingCode,
  copied,
  savePending,
  regeneratePending,
  inviteUrl,
  onCopyHandshakeCode,
  onRegenerateHandshake,
  rowClassName,
  compact = false,
}: {
  isPaired: boolean;
  pairingCode: string | null;
  copied: boolean;
  savePending: boolean;
  regeneratePending: boolean;
  inviteUrl: string | null;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
  rowClassName?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-4", !isPaired && "bg-muted/20")}>
      <SettingsRow
        className={rowClassName}
        description={
          pairingCode
            ? isPaired
              ? "Send this code to your bot in Discord to link another account."
              : "Send this code to your bot in Discord to finish linking."
            : isPaired
              ? "Discord is linked. Generate a new code to link another account."
              : "Generate a code, then message it to your bot once."
        }
        label="Pairing code"
      >
        {pairingCode ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <code className="rounded-md border border-border bg-background px-2.5 py-1 text-sm tracking-widest">
              {pairingCode}
            </code>
            <Button
              className="min-w-[5.25rem] justify-center"
              onClick={onCopyHandshakeCode}
              size="sm"
              type="button"
              variant="outline"
            >
              {copied ? (
                <CheckIcon
                  aria-hidden
                  className="size-3.5 text-emerald-600 dark:text-emerald-400"
                />
              ) : (
                <CopyIcon aria-hidden className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              disabled={regeneratePending || savePending}
              onClick={onRegenerateHandshake}
              size="sm"
              type="button"
              variant="outline"
            >
              {regeneratePending ? (
                <Spinner />
              ) : (
                <>
                  <RefreshCwIcon aria-hidden="true" className="size-3.5" />
                  New code
                </>
              )}
            </Button>
          </div>
        ) : isPaired ? (
          <Button
            disabled={regeneratePending || savePending}
            onClick={onRegenerateHandshake}
            size="sm"
            type="button"
            variant="outline"
          >
            {regeneratePending ? (
              <Spinner />
            ) : (
              <>
                <RefreshCwIcon aria-hidden="true" className="size-3.5" />
                New code
              </>
            )}
          </Button>
        ) : (
          <Button
            disabled={regeneratePending || savePending}
            onClick={onRegenerateHandshake}
            size="sm"
            type="button"
          >
            {regeneratePending ? (
              <>
                <Spinner className="size-3" />
                Generating…
              </>
            ) : (
              "Generate pairing code"
            )}
          </Button>
        )}
      </SettingsRow>

      {pairingCode ? (
        <DiscordPairingGuide compact={compact} inviteUrl={inviteUrl} />
      ) : null}
    </div>
  );
}

export function DiscordSettingsConfiguredRows({
  allowedUserSummary,
  savePending,
  onManageAllowedUsers,
  profileId,
  profiles,
  onProfileChange,
  running,
  worker,
  rowClassName,
}: {
  allowedUserSummary: string;
  savePending: boolean;
  onManageAllowedUsers: () => void;
  profileId: string;
  profiles: ProfileSummary[];
  onProfileChange: (profileId: string) => void;
  running: boolean;
  worker: { process?: { managed?: boolean } } | null | undefined;
  rowClassName?: string;
}) {
  return (
    <div className="space-y-4">
      <SettingsRow
        className={rowClassName}
        description="Discord user IDs that can use this bot"
        label="Allowed users"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-muted-foreground text-xs">
            {allowedUserSummary}
          </span>
          <Button
            disabled={savePending}
            onClick={onManageAllowedUsers}
            size="sm"
            type="button"
            variant="outline"
          >
            Manage
          </Button>
        </div>
      </SettingsRow>

      <SettingsRow
        className={rowClassName}
        description="Which agent answers on Discord"
        label="Reply as"
      >
        <Select
          disabled={savePending || profiles.length === 0}
          onValueChange={(value) => {
            if (value) {
              onProfileChange(String(value));
            }
          }}
          value={profileId}
        >
          <SelectTrigger
            className="w-[11rem] sm:w-[13rem]"
            id="discord-profile"
          >
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

      <SettingsRow
        className={rowClassName}
        description={running ? "Running" : "Stopped"}
        label="Bridge worker"
      >
        <WorkerActionBar
          pm2Managed={worker?.process?.managed ?? false}
          running={running}
          workerName="discord"
        />
      </SettingsRow>
    </div>
  );
}
