import { Switch } from "@nakama/ui/switch";
import {
  ChannelAccessSettings,
  ChannelConnectionStep,
  ChannelSettings,
  ChannelSetupChecklist,
  IntegrationSettingsFooter,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { WhatsAppSettingsLinkingSection } from "@/components/whatsapp-settings-linking-section";

export function WhatsAppSettingsCardContent({
  embedded,
  statusBadge,
  configured,
  paired,
  running,
  showQr,
  linkedNumber,
  savePending,
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
  savePending: boolean;
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
  const paneItemClass = "px-4 py-3";
  const linking = (
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
  );
  const footer = (
    <IntegrationSettingsFooter
      canSave={canSave}
      className={paneItemClass}
      formError={formError}
      loadError={loadError}
      onSave={onSave}
      savePending={savePending}
      showSave={canSave || savePending}
      statusLine={statusLine}
      submitLabel={actionLabel}
    />
  );
  const step =
    !(configured && running) || (paired && statusBadge !== "Connected")
      ? 0
      : paired && !showQr
        ? 2
        : 1;
  const checklist = (
    <ChannelSetupChecklist
      label="WhatsApp setup progress"
      step={step}
      steps={["Start connection", "Link account"]}
    >
      {step === 0 && configured ? (
        <ChannelConnectionStep
          managed={worker?.process?.managed === true}
          platform="whatsapp"
          running={running}
          starting={savePending}
        >
          <WorkerActionBar
            compact
            pm2Managed={worker?.process?.managed ?? false}
            running={running}
            workerName="whatsapp"
          />
        </ChannelConnectionStep>
      ) : null}
      {step === 1 ? linking : null}
      {footer}
    </ChannelSetupChecklist>
  );
  if (step < 2) {
    return checklist;
  }
  return (
    <div className="space-y-4">
      {checklist}
      <ChannelAccessSettings
        actions={
          <WorkerActionBar
            compact
            pm2Managed={worker?.process?.managed ?? false}
            running={running}
            workerName="whatsapp"
          />
        }
        configured={configured}
        onEdit={onManageAllowedPhones}
        pending={savePending}
        statusBadge={statusBadge}
        summary={allowedPhoneSummary}
      />
      <ChannelSettings>
        {linkedNumber ? (
          <SettingsRow label="Connected number">
            <span className="text-foreground text-sm">{linkedNumber}</span>
          </SettingsRow>
        ) : null}
        <SettingsRow label="Only reply when mentioned in groups">
          <Switch
            aria-label="Only reply when mentioned in groups"
            checked={requireGroupMention}
            disabled={savePending}
            id="whatsapp-require-group-mention"
            onCheckedChange={onRequireGroupMentionChange}
          />
        </SettingsRow>
        {linking}
      </ChannelSettings>

      {footer}
    </div>
  );
}
