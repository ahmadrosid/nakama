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
  PairingStepTile,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { cn } from "@/lib/utils";

function TelegramPairingGuide() {
  return (
    <div className="space-y-3 px-4 py-3">
      <p className="text-xs font-medium text-foreground">Link in Telegram</p>
      <div className="overflow-hidden border border-border">
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <PairingStepTile
            step={1}
            title="Open the bot"
            className="border-b border-border sm:border-b-0 sm:border-r"
            description="Start a private chat with your bot."
          />
          <PairingStepTile
            step={2}
            title="Send the code"
            description="Paste the pairing code and send it."
          />
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
          Using the bot in a group?
        </summary>
        <div className="mt-3 overflow-hidden border border-border">
          <PairingStepTile
            step={1}
            title="Pair privately first"
            className="border-b border-border"
            description="Link your account in a private chat before using groups."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <PairingStepTile
              step={2}
              title="Disable Group Privacy"
              className="border-b border-border sm:border-b-0 sm:border-r"
              description={
                <>
                  Turn it off in{" "}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    @BotFather
                  </a>{" "}
                  so @mentions work.
                </>
              }
            />
            <PairingStepTile
              step={3}
              title="Re-add the bot"
              className="border-b border-border"
              description="Remove and re-add the bot after changing Group Privacy."
            />
          </div>
          <PairingStepTile
            step={4}
            title="Trigger in the group"
            description="@mention the bot, reply to it, or use a slash command."
          />
        </div>
      </details>
    </div>
  );
}

export type TelegramSettingsCardView = {
  embedded: boolean;
  configured: boolean;
  hasLinkedUsers: boolean;
  running: boolean;
  showBotToken: boolean;
  savePending: boolean;
  isPaired: boolean;
  regeneratePending: boolean;
  canSave: boolean;
};

export function TelegramSettingsCardContent({
  view,
  headerSubtitle,
  statusBadge,
  settings,
  botToken,
  onBotTokenChange,
  onToggleShowBotToken,
  pairingCode,
  onCopyHandshakeCode,
  onRegenerateHandshake,
  allowedUserSummary,
  onManageAllowedUsers,
  profileId,
  profiles,
  onProfileChange,
  worker,
  statusLine,
  formError,
  loadError,
  submitLabel,
  onSave,
}: {
  view: TelegramSettingsCardView;
  headerSubtitle: string;
  statusBadge: string;
  settings: { botTokenMasked?: string | null } | null | undefined;
  botToken: string;
  onBotTokenChange: (value: string) => void;
  onToggleShowBotToken: () => void;
  pairingCode: string | null;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
  allowedUserSummary: string;
  onManageAllowedUsers: () => void;
  profileId: string;
  profiles: ProfileSummary[];
  onProfileChange: (profileId: string) => void;
  worker: { process?: { managed?: boolean } } | null | undefined;
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  submitLabel: string;
  onSave: () => void;
}) {
  const {
    embedded,
    configured,
    hasLinkedUsers,
    running,
    showBotToken,
    savePending,
    isPaired,
    regeneratePending,
    canSave,
  } = view;

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
              pairingCode
                ? isPaired
                  ? "Message this code to your bot to link another account."
                  : "Message this code to your bot to finish linking."
                : isPaired
                  ? "Linked. Generate a new code to add another account."
                  : "Generate a code, then message it to your bot once."
            }
          >
            {pairingCode ? (
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
            ) : isPaired ? (
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

          {pairingCode ? <TelegramPairingGuide /> : null}
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
