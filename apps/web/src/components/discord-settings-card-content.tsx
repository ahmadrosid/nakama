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
