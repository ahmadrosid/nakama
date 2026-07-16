import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import type { ProfileSummary } from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { DiscordPairingGuide, SettingsRow } from "@/components/discord-settings-card.shared";
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
}: {
  isPaired: boolean;
  pairingCode: string | null;
  copied: boolean;
  savePending: boolean;
  regeneratePending: boolean;
  inviteUrl: string | null;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
}) {
  return (
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

      {!isPaired && pairingCode ? <DiscordPairingGuide inviteUrl={inviteUrl} /> : null}
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
}: {
  allowedUserSummary: string;
  savePending: boolean;
  onManageAllowedUsers: () => void;
  profileId: string;
  profiles: ProfileSummary[];
  onProfileChange: (profileId: string) => void;
  running: boolean;
  worker: { process?: { managed?: boolean } } | null | undefined;
}) {
  return (
    <>
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

      <SettingsRow label="Bridge worker" description={running ? "Running" : "Stopped"}>
        <WorkerActionBar
          workerName="discord"
          running={running}
          pm2Managed={worker?.process?.managed ?? false}
        />
      </SettingsRow>
    </>
  );
}
