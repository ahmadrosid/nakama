import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import { SettingsRow } from "@/components/discord-settings-card.shared";
import { DiscordSettingsPairingSection } from "@/components/discord-settings-pairing-section";
import {
  ChannelAccessSettings,
  ChannelConnectionStep,
  ChannelSettings,
  ChannelSetupChecklist,
  IntegrationSettingsFooter,
} from "@/components/integration-settings.shared";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import {
  DISCORD_DEVELOPER_PORTAL_URL,
  DISCORD_SETUP_GUIDE_URL,
} from "@/lib/integration-docs";

function DiscordBotTokenFields({
  configured,
  settings,
  botToken,
  onBotTokenChange,
  onBotTokenPaste,
  onToggleShowBotToken,
  savePending,
  showBotToken,
}: {
  configured: boolean;
  settings: { botTokenMasked?: string | null } | null | undefined;
  botToken: string;
  onBotTokenChange: (value: string) => void;
  onBotTokenPaste: (value: string) => void;
  onToggleShowBotToken: () => void;
  savePending: boolean;
  showBotToken: boolean;
}) {
  return (
    <SettingsRow className="px-4 py-3" label="Bot token" layout="stacked">
      <details className="mb-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground focus-visible:outline-ring">
          How to get your bot token
        </summary>
        <div className="space-y-3 pt-3 text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <a
                className="font-medium text-primary underline-offset-2 hover:underline"
                href={DISCORD_DEVELOPER_PORTAL_URL}
                rel="noreferrer"
                target="_blank"
              >
                Open Discord Developer Portal ↗
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </li>
            <li>
              Choose your application, or click <strong>New Application</strong>
              .
            </li>
            <li>
              Open <strong>Bot → Reset Token</strong>, then copy the token.
            </li>
            <li>Return here and paste it below.</li>
          </ol>
          <p className="text-xs">
            Resetting a token replaces the old one. Update any other apps using
            this bot.
          </p>
          <a
            className="text-primary text-xs underline-offset-2 hover:underline"
            href={DISCORD_SETUP_GUIDE_URL}
            rel="noreferrer"
            target="_blank"
          >
            Full setup guide
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </details>
      <InputGroup className="w-full">
        <InputGroupInput
          aria-label="Bot token"
          autoComplete="off"
          disabled={savePending}
          id="discord-bot-token"
          onChange={(event) => onBotTokenChange(event.target.value)}
          onPaste={(event) => {
            if (configured) {
              return;
            }
            const token = event.clipboardData.getData("text").trim();
            if (token) {
              event.preventDefault();
              onBotTokenPaste(token);
            }
          }}
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
  );
}

export type DiscordSettingsCardView = {
  embedded: boolean;
  configured: boolean;
  hasLinkedUsers: boolean;
  running: boolean;
  showBotToken: boolean;
  savePending: boolean;
  isPaired: boolean;
  copied: boolean;
  regeneratePending: boolean;
  canSave: boolean;
};

function discordSetupStep(
  configured: boolean,
  running: boolean,
  connected: boolean,
  hasLinkedUsers: boolean
) {
  if (!configured) {
    return 0;
  }
  if (!(running && connected)) {
    return 1;
  }
  return hasLinkedUsers ? 3 : 2;
}

export function DiscordSettingsCardContent({
  view,
  statusBadge,
  settings,
  botToken,
  onBotTokenChange,
  onBotTokenPaste,
  onToggleShowBotToken,
  pairingCode,
  onCopyHandshakeCode,
  onRegenerateHandshake,
  allowedUserSummary,
  onManageAllowedUsers,
  worker,
  statusLine,
  formError,
  loadError,
  submitLabel,
  onSave,
}: {
  view: DiscordSettingsCardView;
  statusBadge: string;
  settings:
    | {
        botTokenMasked?: string | null;
        inviteUrl?: string | null;
      }
    | null
    | undefined;
  botToken: string;
  onBotTokenChange: (value: string) => void;
  onBotTokenPaste: (value: string) => void;
  onToggleShowBotToken: () => void;
  pairingCode: string | null;
  onCopyHandshakeCode: () => void;
  onRegenerateHandshake: () => void;
  allowedUserSummary: string;
  onManageAllowedUsers: () => void;
  worker:
    | { connected?: boolean; process?: { managed?: boolean } }
    | null
    | undefined;
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  submitLabel: string;
  onSave: () => void;
}) {
  const {
    configured,
    hasLinkedUsers,
    running,
    showBotToken,
    savePending,
    isPaired,
    copied,
    regeneratePending,
    canSave,
  } = view;

  const paneItemClass = "px-4 py-3";

  const step = discordSetupStep(
    configured,
    running,
    worker?.connected === true,
    hasLinkedUsers
  );
  const tokenEditor = (
    <DiscordBotTokenFields
      botToken={botToken}
      configured={configured}
      onBotTokenChange={onBotTokenChange}
      onBotTokenPaste={onBotTokenPaste}
      onToggleShowBotToken={onToggleShowBotToken}
      savePending={savePending}
      settings={settings}
      showBotToken={showBotToken}
    />
  );
  const workerActions = (
    <WorkerActionBar
      compact
      pm2Managed={worker?.process?.managed ?? false}
      running={running}
      workerName="discord"
    />
  );
  const pairing = (
    <DiscordSettingsPairingSection
      compact
      copied={copied}
      guided={step === 2}
      inviteUrl={settings?.inviteUrl ?? null}
      isPaired={isPaired}
      onCopyHandshakeCode={onCopyHandshakeCode}
      onRegenerateHandshake={onRegenerateHandshake}
      pairingCode={pairingCode}
      regeneratePending={regeneratePending}
      rowClassName={paneItemClass}
      savePending={savePending}
    />
  );
  const footer = (
    <IntegrationSettingsFooter
      canSave={canSave}
      className={paneItemClass}
      formError={formError}
      loadError={loadError}
      onSave={onSave}
      savePending={savePending}
      showSave={canSave || savePending || !configured}
      statusLine={statusLine}
      submitLabel={configured ? submitLabel : "Continue"}
    />
  );

  const checklist = (
    <ChannelSetupChecklist
      label="Discord setup progress"
      step={step}
      steps={["Add bot", "Start connection", "Link account"]}
    >
      {step === 0 ? tokenEditor : null}
      {step === 1 ? (
        <ChannelConnectionStep
          managed={worker?.process?.managed === true}
          platform="discord"
          running={running}
          starting={savePending}
        >
          {workerActions}
          {tokenEditor}
        </ChannelConnectionStep>
      ) : null}
      {step === 2 ? <div className="px-4 pb-3">{pairing}</div> : null}
      {footer}
    </ChannelSetupChecklist>
  );
  if (step < 3) {
    return checklist;
  }

  return (
    <div className="space-y-4">
      {checklist}
      <ChannelAccessSettings
        actions={workerActions}
        configured={configured}
        onEdit={onManageAllowedUsers}
        pending={savePending}
        statusBadge={statusBadge}
        summary={allowedUserSummary}
      />
      <ChannelSettings>
        {tokenEditor}
        {pairing}
      </ChannelSettings>

      {footer}
    </div>
  );
}
