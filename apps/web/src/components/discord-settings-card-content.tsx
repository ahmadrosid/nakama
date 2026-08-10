import type { ProfileSummary } from "@nakama/core/contract";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import { SettingsRow } from "@/components/discord-settings-card.shared";
import {
  DiscordSettingsConfiguredRows,
  DiscordSettingsPairingSection,
} from "@/components/discord-settings-pairing-section";
import {
  IntegrationSettingsFooter,
  IntegrationStatusHeader,
} from "@/components/integration-settings.shared";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  DISCORD_DEVELOPER_PORTAL_URL,
  DISCORD_SETUP_GUIDE_URL,
} from "@/lib/integration-docs";
import { cn } from "@/lib/utils";

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
  settings:
    | {
        botTokenMasked?: string | null;
        inviteUrl?: string | null;
      }
    | null
    | undefined;
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
          title="Discord"
        />
      )}

      <SettingsRow
        className={paneItemClass}
        description={
          <>
            Create a bot in the{" "}
            <a
              className="font-medium text-primary underline-offset-2 hover:underline"
              href={DISCORD_DEVELOPER_PORTAL_URL}
              rel="noreferrer"
              target="_blank"
            >
              Discord Developer Portal
            </a>
            . Follow the{" "}
            <a
              className="font-medium text-primary underline-offset-2 hover:underline"
              href={DISCORD_SETUP_GUIDE_URL}
              rel="noreferrer"
              target="_blank"
            >
              setup guide
            </a>{" "}
            for token, intents, and invite steps.
          </>
        }
        label="Bot token"
        layout="stacked"
      >
        <InputGroup className="w-full">
          <InputGroupInput
            autoComplete="off"
            disabled={savePending}
            id="discord-bot-token"
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
        <DiscordSettingsPairingSection
          compact={!embedded}
          copied={copied}
          inviteUrl={settings?.inviteUrl ?? null}
          isPaired={isPaired}
          onCopyHandshakeCode={onCopyHandshakeCode}
          onRegenerateHandshake={onRegenerateHandshake}
          pairingCode={pairingCode}
          regeneratePending={regeneratePending}
          rowClassName={paneItemClass}
          savePending={savePending}
        />
      ) : null}

      {configured ? (
        <DiscordSettingsConfiguredRows
          allowedUserSummary={allowedUserSummary}
          onManageAllowedUsers={onManageAllowedUsers}
          onProfileChange={onProfileChange}
          profileId={profileId}
          profiles={profiles}
          rowClassName={paneItemClass}
          running={running}
          savePending={savePending}
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
