import type { ProfileSummary } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { Switch } from "@nakama/ui/switch";
import { cn } from "@nakama/ui/utils";
import {
  IntegrationSettingsFooter,
  IntegrationStatusHeader,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { WhatsAppSettingsLinkingSection } from "@/components/whatsapp-settings-linking-section";

export function WhatsAppSettingsCardContent({
  embedded,
  headerSubtitle,
  statusBadge,
  configured,
  paired,
  running,
  showQr,
  linkedNumber,
  profileId,
  profiles,
  savePending,
  onProfileChange,
  pairingCode,
  copied,
  onCopyPairingCode,
  onRegeneratePairingCode,
  regeneratePending,
  qrCode,
  linkingAfterScan,
  bridgeStarting,
  awaitingQr,
  showReconnect,
  onReconnect,
  reconnectPending,
  worker,
  statusLine,
  formError,
  loadError,
  canSave,
  actionLabel,
  allowedPhoneSummary,
  onManageAllowedPhones,
  requireGroupMention,
  onRequireGroupMentionChange,
  onSave,
}: {
  embedded: boolean;
  headerSubtitle: string;
  statusBadge: string;
  configured: boolean;
  paired: boolean;
  running: boolean;
  showQr: boolean;
  linkedNumber: string | null;
  profileId: string;
  profiles: ProfileSummary[];
  savePending: boolean;
  onProfileChange: (profileId: string) => void;
  pairingCode: string | null;
  copied: boolean;
  onCopyPairingCode: () => void;
  onRegeneratePairingCode: () => void;
  regeneratePending: boolean;
  qrCode: string | null;
  linkingAfterScan: boolean;
  bridgeStarting: boolean;
  awaitingQr: boolean;
  showReconnect: boolean;
  onReconnect: () => void;
  reconnectPending: boolean;
  worker: { process?: { managed?: boolean } } | null | undefined;
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  canSave: boolean;
  actionLabel: string;
  allowedPhoneSummary: string;
  onManageAllowedPhones: () => void;
  requireGroupMention: boolean;
  onRequireGroupMentionChange: (value: boolean) => void;
  onSave: () => void;
}) {
  const paneItemClass = embedded ? undefined : "px-0 py-0";

  return (
    <div className={cn(!embedded && "space-y-4 py-4")}>
      {embedded ? null : (
        <IntegrationStatusHeader
          className={paneItemClass}
          configured={configured}
          connected={paired && running && !showQr}
          statusBadge={statusBadge}
          subtitle={headerSubtitle}
          title="WhatsApp"
        />
      )}

      {linkedNumber ? (
        <SettingsRow
          className={paneItemClass}
          description="From your WhatsApp session"
          label="Linked account"
        >
          <span className="text-foreground text-sm">{linkedNumber}</span>
        </SettingsRow>
      ) : null}

      <SettingsRow
        className={paneItemClass}
        description="Which agent answers on WhatsApp"
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
            id="whatsapp-profile"
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
        description="Off: anyone in the group can talk without tagging the bot"
        label="Require @mention in groups"
      >
        <Switch
          aria-label="Require @mention in groups"
          checked={requireGroupMention}
          disabled={savePending}
          id="whatsapp-require-group-mention"
          onCheckedChange={onRequireGroupMentionChange}
        />
      </SettingsRow>

      {configured ? (
        <SettingsRow className={paneItemClass} label="Allowed numbers">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-muted-foreground text-xs">
              {allowedPhoneSummary}
            </span>
            <Button
              disabled={savePending}
              onClick={onManageAllowedPhones}
              size="sm"
              type="button"
              variant="outline"
            >
              Manage
            </Button>
          </div>
        </SettingsRow>
      ) : null}

      {configured ? (
        <WhatsAppSettingsLinkingSection
          awaitingQr={awaitingQr}
          bridgeStarting={bridgeStarting}
          compact={!embedded}
          copied={copied}
          linkingAfterScan={linkingAfterScan}
          onCopyPairingCode={onCopyPairingCode}
          onReconnect={onReconnect}
          onRegeneratePairingCode={onRegeneratePairingCode}
          paired={paired}
          pairingCode={pairingCode}
          qrCode={qrCode}
          reconnectPending={reconnectPending}
          regeneratePending={regeneratePending}
          rowClassName={paneItemClass}
          savePending={savePending}
          showQr={showQr}
          showReconnect={showReconnect}
        />
      ) : null}

      {configured ? (
        <SettingsRow
          className={paneItemClass}
          description={running ? "Running" : "Stopped"}
          label="Bridge worker"
        >
          <WorkerActionBar
            pm2Managed={worker?.process?.managed ?? false}
            running={running}
            workerName="whatsapp"
          />
        </SettingsRow>
      ) : null}

      <IntegrationSettingsFooter
        canSave={canSave}
        className={paneItemClass}
        formError={formError}
        loadError={loadError}
        onSave={onSave}
        savePending={savePending}
        statusLine={statusLine}
        submitLabel={actionLabel}
      />
    </div>
  );
}
