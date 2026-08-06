import type { ProfileSummary } from "@nakama/core/contract";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  IntegrationSettingsFooter,
  IntegrationStatusHeader,
} from "@/components/integration-settings.shared";
import { DiscordSettingsConfiguredRows, DiscordSettingsPairingSection } from "@/components/discord-settings-pairing-section";
import { SettingsRow } from "@/components/discord-settings-card.shared";
import { DISCORD_DEVELOPER_PORTAL_URL, DISCORD_SETUP_GUIDE_URL } from "@/lib/integration-docs";

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

export function DiscordSettingsCardContent({
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
  view: DiscordSettingsCardView;
  headerSubtitle: string;
  statusBadge: string;
  settings: {
    botTokenMasked?: string | null;
    inviteUrl?: string | null;
  } | null | undefined;
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
    copied,
    regeneratePending,
    canSave,
  } = view;

  return (
    <div className="divide-y divide-border">
      {!embedded ? (
        <IntegrationStatusHeader
          title="Discord"
          subtitle={headerSubtitle}
          statusBadge={statusBadge}
          configured={configured}
          connected={hasLinkedUsers && running}
        />
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
        <DiscordSettingsPairingSection
          isPaired={isPaired}
          pairingCode={pairingCode}
          copied={copied}
          savePending={savePending}
          regeneratePending={regeneratePending}
          inviteUrl={settings?.inviteUrl ?? null}
          onCopyHandshakeCode={onCopyHandshakeCode}
          onRegenerateHandshake={onRegenerateHandshake}
        />
      ) : null}

      {configured ? (
        <DiscordSettingsConfiguredRows
          allowedUserSummary={allowedUserSummary}
          savePending={savePending}
          onManageAllowedUsers={onManageAllowedUsers}
          profileId={profileId}
          profiles={profiles}
          onProfileChange={onProfileChange}
          running={running}
          worker={worker}
        />
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
