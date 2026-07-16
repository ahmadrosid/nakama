import type { ProfileSummary } from "@nakama/core/contract";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IntegrationSettingsFooter,
  IntegrationStatusHeader,
  SettingsRow,
} from "@/components/integration-settings.shared";
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
  onSave: () => void;
}) {
  return (
    <div className="divide-y divide-border">
      {!embedded ? (
        <IntegrationStatusHeader
          title="WhatsApp"
          subtitle={headerSubtitle}
          statusBadge={statusBadge}
          configured={configured}
          connected={paired && running && !showQr}
        />
      ) : null}

      {linkedNumber ? (
        <SettingsRow label="Linked account" description="From your WhatsApp session">
          <span className="text-sm text-foreground">{linkedNumber}</span>
        </SettingsRow>
      ) : null}

      <SettingsRow label="Reply as" description="Which agent answers on WhatsApp">
        <Select
          value={profileId}
          disabled={savePending || profiles.length === 0}
          onValueChange={(value) => {
            if (value) {
              onProfileChange(String(value));
            }
          }}
        >
          <SelectTrigger id="whatsapp-profile" className="w-[11rem] sm:w-[13rem]">
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

      {configured ? (
        <WhatsAppSettingsLinkingSection
          paired={paired}
          pairingCode={pairingCode}
          copied={copied}
          savePending={savePending}
          regeneratePending={regeneratePending}
          onCopyPairingCode={onCopyPairingCode}
          onRegeneratePairingCode={onRegeneratePairingCode}
          showQr={showQr}
          qrCode={qrCode}
          linkingAfterScan={linkingAfterScan}
          bridgeStarting={bridgeStarting}
          awaitingQr={awaitingQr}
          showReconnect={showReconnect}
          reconnectPending={reconnectPending}
          onReconnect={onReconnect}
        />
      ) : null}

      {configured ? (
        <SettingsRow label="Bridge worker" description={running ? "Running" : "Stopped"}>
          <WorkerActionBar
            workerName="whatsapp"
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
        submitLabel={actionLabel}
        onSave={onSave}
      />
    </div>
  );
}
