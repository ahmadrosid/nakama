import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import { Switch } from "@nakama/ui/switch";
import {
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
  connected,
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
  allowUnpairedGroupMembers,
  onAllowUnpairedGroupMembersChange,
  onSave,
}: {
  embedded: boolean;
  connected: boolean;
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
  worker:
    | { process?: { error?: string; managed?: boolean } }
    | null
    | undefined;
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  canSave: boolean;
  actionLabel: string;
  allowedPhoneSummary: string;
  onManageAllowedPhones: () => void;
  requireGroupMention: boolean;
  onRequireGroupMentionChange: (value: boolean) => void;
  allowUnpairedGroupMembers: boolean;
  onAllowUnpairedGroupMembersChange: (value: boolean) => void;
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

  let step = running ? 1 : 0;

  if (paired) {
    step = 2;
  }

  if (showQr || awaitingQr || bridgeStarting || linkingAfterScan) {
    step = 1;
  }

  if (!configured) {
    step = 0;
  }

  const isConnected = running && connected;
  const managed = worker?.process?.managed === true;

  const workerActions = (
    <WorkerActionBar
      compact
      pm2Error={worker?.process?.error}
      pm2Managed={managed}
      running={running}
      workerName="whatsapp"
    />
  );

  const checklist = (
    <ChannelSetupChecklist
      label="WhatsApp setup progress"
      step={step}
      steps={["Start connection", "Link account"]}
    >
      {step === 0 && configured ? (
        <ChannelConnectionStep
          managed={managed}
          platform="whatsapp"
          running={running}
          starting={savePending}
        >
          {workerActions}
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
      <div
        className="group flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 data-[connected=true]:border-border data-[connected=true]:bg-card"
        data-connected={isConnected}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full bg-amber-500 group-data-[connected=true]:bg-emerald-600"
          />
          <div className="min-w-0">
            <p className="font-semibold text-sm">
              {isConnected ? "Connected" : "Offline"}
            </p>
            <p
              className="break-all text-muted-foreground text-xs"
              hidden={!linkedNumber}
            >
              {linkedNumber}
            </p>
          </div>
        </div>
        {workerActions}
      </div>
      <Card className="w-full overflow-hidden shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <SettingsRow label="Who can message this agent?">
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
                Edit
              </Button>
            </div>
          </SettingsRow>
        </CardContent>
      </Card>
      <ChannelSettings>
        <SettingsRow label="Only reply when mentioned in groups">
          <Switch
            aria-label="Only reply when mentioned in groups"
            checked={requireGroupMention}
            disabled={savePending}
            id="whatsapp-require-group-mention"
            onCheckedChange={onRequireGroupMentionChange}
          />
        </SettingsRow>
        <SettingsRow label="Reply to unpaired group members">
          <Switch
            aria-label="Reply to unpaired group members"
            checked={allowUnpairedGroupMembers}
            disabled={savePending}
            id="whatsapp-allow-unpaired-group-members"
            onCheckedChange={onAllowUnpairedGroupMembersChange}
          />
        </SettingsRow>
        {linking}
      </ChannelSettings>

      {footer}
    </div>
  );
}
