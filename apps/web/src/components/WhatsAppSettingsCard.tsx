import { SETTINGS_CARD_LOADING_SKELETON } from "@/components/integration-settings.shared";
import { WhatsAppAllowedPhonesDialog } from "@/components/WhatsAppAllowedPhonesDialog";
import { WhatsAppSettingsCardContent } from "@/components/whatsapp-settings-card-content";
import { useWhatsAppSettingsCard } from "@/hooks/use-whatsapp-settings-card";

interface WhatsAppSettingsCardProps {
  embedded?: boolean;
  onSaveSuccess?: () => void;
  submitLabel?: string;
}

export function WhatsAppSettingsCard({
  embedded = false,
  submitLabel,
  onSaveSuccess,
}: WhatsAppSettingsCardProps) {
  const card = useWhatsAppSettingsCard({ onSaveSuccess, submitLabel });

  if (card.isLoading) {
    if (embedded) {
      return SETTINGS_CARD_LOADING_SKELETON;
    }

    return <div className="py-3">{SETTINGS_CARD_LOADING_SKELETON}</div>;
  }

  const allowedPhonesDialog = (
    <WhatsAppAllowedPhonesDialog
      allowedPhones={card.allowedPhones}
      onAllowedPhonesChange={card.onAllowedPhonesChange}
      onError={card.onError}
      onOpenChange={card.onAllowedPhonesOpenChange}
      onSaved={card.onSavedAllowedPhones}
      open={card.allowedPhonesOpen}
      profileId={card.profileId}
    />
  );

  const content = (
    <WhatsAppSettingsCardContent
      actionLabel={card.actionLabel}
      allowedPhoneSummary={card.allowedPhoneSummary}
      awaitingQr={card.awaitingQr}
      bridgeStarting={card.bridgeStarting}
      canSave={card.canSave}
      configured={card.configured}
      copied={card.copied}
      embedded={embedded}
      formError={card.formError}
      headerSubtitle={card.headerSubtitle}
      linkedNumber={card.linkedNumber}
      linkingAfterScan={card.linkingAfterScan}
      loadError={card.loadError}
      onCopyPairingCode={card.onCopyPairingCode}
      onManageAllowedPhones={card.onManageAllowedPhones}
      onProfileChange={card.onProfileChange}
      onReconnect={card.onReconnect}
      onRegeneratePairingCode={card.onRegeneratePairingCode}
      onRequireGroupMentionChange={card.onRequireGroupMentionChange}
      onSave={card.onSave}
      paired={card.paired}
      pairingCode={card.pairingCode}
      profileId={card.profileId}
      profiles={card.profiles}
      qrCode={card.qrCode}
      reconnectPending={card.reconnectPending}
      regeneratePending={card.regeneratePending}
      requireGroupMention={card.requireGroupMention}
      running={card.running}
      savePending={card.savePending}
      showQr={card.showQr}
      showReconnect={card.showReconnect}
      statusBadge={card.statusBadge}
      statusLine={card.statusLine}
      worker={card.worker}
    />
  );

  if (embedded) {
    return (
      <>
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">{card.headerSubtitle}</p>
          {content}
        </div>
        {allowedPhonesDialog}
      </>
    );
  }

  return (
    <>
      {content}
      {allowedPhonesDialog}
    </>
  );
}
