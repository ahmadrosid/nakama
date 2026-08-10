import type { UpdateWhatsAppSettingsRequest } from "@nakama/core/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { SETTINGS_CARD_LOADING_SKELETON } from "@/components/integration-settings.shared";
import { WhatsAppSettingsCardContent } from "@/components/whatsapp-settings-card-content";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import {
  useReconnectWhatsApp,
  useRegenerateWhatsAppPairingCode,
  useSaveWhatsAppSettings,
  useWhatsAppSettings,
} from "@/hooks/use-whatsapp-settings";
import { formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

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
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error: loadError } = useWhatsAppSettings();
  const { data: status } = useSystemStatusQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const saveMutation = useSaveWhatsAppSettings();
  const regenerateMutation = useRegenerateWhatsAppPairingCode();
  const reconnectMutation = useReconnectWhatsApp();

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [profileId, setProfileId] = useState("default");
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [qrWasVisible, setQrWasVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const settingsProfileId = settings?.profileId;

  useEffect(() => {
    if (settingsProfileId !== undefined) {
      setProfileId(settingsProfileId);
    }
  }, [settingsProfileId]);

  const configured = settings?.configured === true;
  const worker = status?.whatsappWorker;
  const running = worker?.running === true;
  const connected = worker?.connected === true;
  const qrCode = worker?.qrCode ?? null;
  const paired = Boolean(worker?.paired || settings?.pairedJid);
  const pairingCode = settings?.pairingCode ?? null;
  const linkedNumber = settings?.phoneNumberMasked ?? null;

  useEffect(() => {
    if (qrCode) {
      setQrWasVisible(true);
    }
    if (paired) {
      setQrWasVisible(false);
    }
  }, [qrCode, paired]);

  useEffect(() => {
    if (worker?.paired && !settings?.pairedJid) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.whatsapp.settings,
      });
      return;
    }

    if (worker?.connected && !paired) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.whatsapp.settings,
      });
    }
  }, [
    worker?.paired,
    worker?.connected,
    settings?.pairedJid,
    paired,
    queryClient,
  ]);

  useEffect(() => {
    setCopied(false);
  }, [pairingCode]);

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    },
    []
  );

  const useQrLinking = !pairingCode;
  const showQr = configured && running && Boolean(qrCode) && useQrLinking;
  const awaitingQr =
    configured &&
    !paired &&
    running &&
    !connected &&
    !qrCode &&
    !qrWasVisible &&
    useQrLinking;
  const bridgeStarting =
    configured && !paired && running && !connected && Boolean(pairingCode);
  const linkingAfterScan =
    configured &&
    !paired &&
    running &&
    !qrCode &&
    (qrWasVisible || connected) &&
    useQrLinking;
  const showReconnect = configured && !showQr && !awaitingQr;
  const canSave = !configured || profileId !== settings?.profileId;
  const actionLabel = submitLabel ?? (configured ? "Save" : "Enable WhatsApp");

  const statusLine =
    hint ??
    (formError ? formError : null) ??
    (loadError ? formatError(loadError) : null);

  const headerSubtitle = configured
    ? paired && running && !showQr
      ? "WhatsApp is linked and the bridge is running"
      : paired && !running
        ? "Linked. Start the WhatsApp bridge to receive messages"
        : showQr
          ? "Scan the QR code with WhatsApp to link your device"
          : linkingAfterScan
            ? "Linking your WhatsApp account…"
            : bridgeStarting
              ? "Bridge starting — enter the pairing code in WhatsApp"
              : awaitingQr
                ? "Preparing QR code…"
                : pairingCode
                  ? "Enter the pairing code in WhatsApp"
                  : "Scan the QR code, or generate a pairing code"
    : "Choose a profile and enable WhatsApp to get started";

  const statusBadge = configured
    ? paired && running && !showQr
      ? "Connected"
      : paired && !running
        ? "Paired"
        : linkingAfterScan
          ? "Linking"
          : bridgeStarting
            ? "Starting…"
            : showQr
              ? "Awaiting scan"
              : awaitingQr
                ? "Starting…"
                : pairingCode
                  ? "Awaiting link"
                  : "Not linked"
    : "Not set up";

  async function copyPairingCode() {
    if (!pairingCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      setHint("Copy the code manually.");
    }
  }

  function handleSave() {
    setFormError(null);
    setHint(null);

    const request: UpdateWhatsAppSettingsRequest = {
      profileId: profileId.trim() || "default",
    };

    saveMutation.mutate(request, {
      onError: (error) => {
        setFormError(formatError(error));
      },
      onSuccess: (saved) => {
        if (saved.pairedJid) {
          setHint("Saved.");
        } else if (saved.pairingCode) {
          setHint("Saved. Use the pairing code in WhatsApp.");
        } else if (configured) {
          setHint("Saved.");
        } else {
          setHint("Enabled. Start the bridge and scan the QR code.");
        }
        onSaveSuccess?.();
      },
    });
  }

  function handleRegeneratePairingCode() {
    setFormError(null);
    setHint(null);

    regenerateMutation.mutate(undefined, {
      onError: (error) => {
        setFormError(formatError(error));
      },
      onSuccess: () => {
        setHint("New code ready.");
      },
    });
  }

  function handleReconnect() {
    setFormError(null);
    setHint(null);
    setQrWasVisible(false);

    reconnectMutation.mutate(undefined, {
      onError: (error) => {
        setFormError(formatError(error));
      },
      onSuccess: () => {
        setHint("Session reset. Scan the QR code when it appears.");
      },
    });
  }

  function handleProfileChange(nextProfileId: string) {
    setProfileId(nextProfileId);
    setHint(null);
    setFormError(null);

    if (!configured || nextProfileId === settings?.profileId) {
      return;
    }

    saveMutation.mutate(
      { profileId: nextProfileId.trim() || "default" },
      {
        onError: (error) => {
          setFormError(formatError(error));
        },
        onSuccess: () => {
          setHint("Reply profile saved.");
        },
      }
    );
  }

  if (isLoading) {
    if (embedded) {
      return SETTINGS_CARD_LOADING_SKELETON;
    }

    return <div className="py-3">{SETTINGS_CARD_LOADING_SKELETON}</div>;
  }

  const content = (
    <WhatsAppSettingsCardContent
      actionLabel={actionLabel}
      awaitingQr={awaitingQr}
      bridgeStarting={bridgeStarting}
      canSave={canSave}
      configured={configured}
      copied={copied}
      embedded={embedded}
      formError={formError}
      headerSubtitle={headerSubtitle}
      linkedNumber={linkedNumber}
      linkingAfterScan={linkingAfterScan}
      loadError={loadError}
      onCopyPairingCode={() => void copyPairingCode()}
      onProfileChange={handleProfileChange}
      onReconnect={handleReconnect}
      onRegeneratePairingCode={handleRegeneratePairingCode}
      onSave={handleSave}
      paired={paired}
      pairingCode={pairingCode}
      profileId={profileId}
      profiles={profiles}
      qrCode={qrCode}
      reconnectPending={reconnectMutation.isPending}
      regeneratePending={regenerateMutation.isPending}
      running={running}
      savePending={saveMutation.isPending}
      showQr={showQr}
      showReconnect={showReconnect}
      statusBadge={statusBadge}
      statusLine={statusLine}
      worker={worker}
    />
  );

  if (embedded) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">{headerSubtitle}</p>
        {content}
      </div>
    );
  }

  return content;
}
