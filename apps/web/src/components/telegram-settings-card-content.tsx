import type { ProfileSummary } from "@nakama/core/contract";
import {
  Copy01Icon,
  RefreshIcon,
  ViewIcon,
  ViewOffIcon,
} from "hugeicons-react";
import {
  IntegrationSettingsFooter,
  IntegrationStatusHeader,
  PairingStepTile,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { ProfileAvatar } from "@/components/ProfileAvatar";
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
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { cn } from "@/lib/utils";

function TelegramPairingGuide() {
  return (
    <div className="space-y-3">
      <p className="font-medium text-foreground text-xs">Link in Telegram</p>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <PairingStepTile
            className="border-border border-b sm:border-r sm:border-b-0"
            description="Start a private chat with your bot."
            step={1}
            title="Open the bot"
          />
          <PairingStepTile
            description="Paste the pairing code and send it."
            step={2}
            title="Send the code"
          />
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-muted-foreground text-xs transition-colors hover:text-foreground">
          Using the bot in a group?
        </summary>
        <div className="mt-3 overflow-hidden rounded-md border border-border">
          <PairingStepTile
            className="border-border border-b"
            description="Link your account in a private chat before using groups."
            step={1}
            title="Pair privately first"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <PairingStepTile
              className="border-border border-b sm:border-r sm:border-b-0"
              description={
                <>
                  Turn it off in{" "}
                  <a
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    href="https://t.me/BotFather"
                    rel="noreferrer"
                    target="_blank"
                  >
                    @BotFather
                  </a>{" "}
                  so @mentions work.
                </>
              }
              step={2}
              title="Disable Group Privacy"
            />
            <PairingStepTile
              className="border-border border-b"
              description="Remove and re-add the bot after changing Group Privacy."
              step={3}
              title="Re-add the bot"
            />
          </div>
          <PairingStepTile
            description="@mention the bot, reply to it, or use a slash command."
            step={4}
            title="Trigger in the group"
          />
        </div>
      </details>
    </div>
  );
}

function pairingCodeDescription(
  pairingCode: string | null,
  isPaired: boolean
): string {
  if (pairingCode) {
    return isPaired
      ? "Message this code to your bot to link another account."
      : "Message this code to your bot to finish linking.";
  }

  return isPaired
    ? "Linked. Generate a new code to add another account."
    : "Generate a code, then message it to your bot once.";
}

function TelegramPairingCodeControls({
  pairingCode,
  isPaired,
  regeneratePending,
  savePending,
  onCopyHandshakeCode,
  onRegenerateHandshake,
}: {
  pairingCode: string | null;
  isPaired: boolean;
  regeneratePending: boolean;
  savePending: boolean;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
}) {
  if (pairingCode) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <code className="rounded-md border border-border bg-background px-2.5 py-1 text-sm tracking-widest">
          {pairingCode}
        </code>
        <Button
          onClick={onCopyHandshakeCode}
          size="sm"
          type="button"
          variant="outline"
        >
          <Copy01Icon className="size-4" />
          Copy
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
              <RefreshIcon aria-hidden="true" className="size-3.5" />
              New code
            </>
          )}
        </Button>
      </div>
    );
  }

  if (isPaired) {
    return (
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
            <RefreshIcon aria-hidden="true" className="size-3.5" />
            New code
          </>
        )}
      </Button>
    );
  }

  return (
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
  );
}

function TelegramConfiguredSections({
  view,
  paneItemClass,
  pairingCode,
  onCopyHandshakeCode,
  onRegenerateHandshake,
  allowedUserSummary,
  onManageAllowedUsers,
  profileId,
  profiles,
  onProfileChange,
  worker,
}: {
  view: TelegramSettingsCardView;
  paneItemClass: string | undefined;
  pairingCode: string | null;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
  allowedUserSummary: string;
  onManageAllowedUsers: () => void;
  profileId: string;
  profiles: ProfileSummary[];
  onProfileChange: (profileId: string) => void;
  worker: { process?: { managed?: boolean } } | null | undefined;
}) {
  const { isPaired, regeneratePending, savePending, running } = view;

  return (
    <>
      <div className={cn("space-y-4", !isPaired && "bg-muted/20")}>
        <SettingsRow
          className={paneItemClass}
          description={pairingCodeDescription(pairingCode, isPaired)}
          label="Pairing code"
        >
          <TelegramPairingCodeControls
            isPaired={isPaired}
            onCopyHandshakeCode={onCopyHandshakeCode}
            onRegenerateHandshake={onRegenerateHandshake}
            pairingCode={pairingCode}
            regeneratePending={regeneratePending}
            savePending={savePending}
          />
        </SettingsRow>

        {pairingCode ? <TelegramPairingGuide /> : null}
      </div>

      <SettingsRow
        className={paneItemClass}
        description="Telegram user IDs that can use this bot"
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
        className={paneItemClass}
        description="Which agent answers on Telegram"
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
            id="telegram-profile"
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
        className={paneItemClass}
        description={running ? "Running" : "Stopped"}
        label="Bridge worker"
      >
        <WorkerActionBar
          pm2Managed={worker?.process?.managed ?? false}
          running={running}
          workerName="telegram"
        />
      </SettingsRow>
    </>
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
    canSave,
  } = view;

  const paneItemClass = embedded ? undefined : "px-0 py-0";

  return (
    <div className={cn(!embedded && "space-y-4 py-4")}>
      {embedded ? null : (
        <IntegrationStatusHeader
          className={paneItemClass}
          configured={configured}
          connected={hasLinkedUsers && running}
          statusBadge={statusBadge}
          subtitle={headerSubtitle}
          title="Telegram"
        />
      )}

      <SettingsRow
        className={paneItemClass}
        description="From @BotFather"
        label="Bot token"
      >
        <InputGroup className="w-full min-w-[12rem] sm:w-[16rem]">
          <InputGroupInput
            autoComplete="off"
            disabled={savePending}
            id="telegram-bot-token"
            onChange={(event) => onBotTokenChange(event.target.value)}
            placeholder={
              configured && settings?.botTokenMasked
                ? `Saved (${settings.botTokenMasked})`
                : "Paste token"
            }
            type={showBotToken ? "text" : "password"}
            value={botToken}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={showBotToken ? "Hide token" : "Show token"}
              onClick={onToggleShowBotToken}
              size="icon-xs"
              type="button"
            >
              {showBotToken ? (
                <ViewOffIcon className="size-4" />
              ) : (
                <ViewIcon className="size-4" />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </SettingsRow>

      {configured ? (
        <TelegramConfiguredSections
          allowedUserSummary={allowedUserSummary}
          onCopyHandshakeCode={onCopyHandshakeCode}
          onManageAllowedUsers={onManageAllowedUsers}
          onProfileChange={onProfileChange}
          onRegenerateHandshake={onRegenerateHandshake}
          pairingCode={pairingCode}
          paneItemClass={paneItemClass}
          profileId={profileId}
          profiles={profiles}
          view={view}
          worker={worker}
        />
      ) : null}

      <IntegrationSettingsFooter
        canSave={canSave}
        className={paneItemClass}
        formError={formError}
        loadError={loadError}
        onSave={onSave}
        savePending={savePending}
        statusLine={statusLine}
        submitLabel={submitLabel}
      />
    </div>
  );
}
