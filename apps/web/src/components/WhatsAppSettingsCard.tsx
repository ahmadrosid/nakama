import { useEffect, useRef, useState } from "react";
import type { UpdateWhatsAppSettingsRequest } from "@nakama/core/contract";
import { useQueryClient } from "@tanstack/react-query";
import { WhatsAppSettingsCardContent } from "@/components/whatsapp-settings-card-content";
import { Card, CardContent } from "@/components/ui/card";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import {
  useRegenerateWhatsAppPairingCode,
  useReconnectWhatsApp,
  useSaveWhatsAppSettings,
  useWhatsAppSettings,
} from "@/hooks/use-whatsapp-settings";
import { formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

interface WhatsAppSettingsCardProps {
  embedded?: boolean;
  submitLabel?: string;
  onSaveSuccess?: () => void;
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

  useEffect(() => {
    if (!settings) {
      return;
    }

    setProfileId(settings.profileId);
  }, [settings?.profileId]);

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
      void queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.settings });
      return;
    }

    if (worker?.connected && !paired) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.whatsapp.settings });
    }
  }, [worker?.paired, worker?.connected, settings?.pairedJid, paired, queryClient]);

  useEffect(() => {
    setCopied(false);
  }, [pairingCode]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const useQrLinking = !pairingCode;
  const showQr = configured && running && Boolean(qrCode) && useQrLinking;
  const awaitingQr =
    configured && !paired && running && !connected && !qrCode && !qrWasVisible && useQrLinking;
  const bridgeStarting = configured && !paired && running && !connected && Boolean(pairingCode);
  const linkingAfterScan =
    configured && !paired && running && !qrCode && (qrWasVisible || connected) && useQrLinking;
  const showReconnect = configured && !showQr && !awaitingQr;
  const canSave = !configured || profileId !== settings?.profileId;
  const actionLabel = submitLabel ?? (configured ? "Save" : "Enable WhatsApp");

  const statusLine =
    hint ?? (formError ? formError : null) ?? (loadError ? formatError(loadError) : null);

  const headerSubtitle = !configured
    ? "Choose a profile and enable WhatsApp to get started"
    : paired && running && !showQr
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
                  : "Scan the QR code, or generate a pairing code";

  const statusBadge = !configured
    ? "Not set up"
    : paired && running && !showQr
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
                  : "Not linked";

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
      onSuccess: (saved) => {
        if (saved.pairedJid) {
          setHint("Saved.");
        } else if (saved.pairingCode) {
          setHint("Saved. Use the pairing code in WhatsApp.");
        } else if (!configured) {
          setHint("Enabled. Start the bridge and scan the QR code.");
        } else {
          setHint("Saved.");
        }
        onSaveSuccess?.();
      },
      onError: (error) => {
        setFormError(formatError(error));
      },
    });
  }

  function handleRegeneratePairingCode() {
    setFormError(null);
    setHint(null);

    regenerateMutation.mutate(undefined, {
      onSuccess: () => {
        setHint("New code ready.");
      },
      onError: (error) => {
        setFormError(formatError(error));
      },
    });
  }

  function handleReconnect() {
    setFormError(null);
    setHint(null);
    setQrWasVisible(false);

    reconnectMutation.mutate(undefined, {
      onSuccess: () => {
        setHint("Session reset. Scan the QR code when it appears.");
      },
      onError: (error) => {
        setFormError(formatError(error));
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
        onSuccess: () => {
          setHint("Reply profile saved.");
        },
        onError: (error) => {
          setFormError(formatError(error));
        },
      },
    );
  }

  if (isLoading) {
    const skeleton = (
      <div className="h-16 animate-pulse rounded-lg bg-muted px-4" aria-hidden="true" />
    );

    if (embedded) {
      return skeleton;
    }

    return (
      <Card className="w-full shadow-none">
        <CardContent className="py-3">{skeleton}</CardContent>
      </Card>
    );
  }

  const content = (
    <WhatsAppSettingsCardContent
      embedded={embedded}
      headerSubtitle={headerSubtitle}
      statusBadge={statusBadge}
      configured={configured}
      paired={paired}
      running={running}
      showQr={showQr}
      linkedNumber={linkedNumber}
      profileId={profileId}
      profiles={profiles}
      savePending={saveMutation.isPending}
      onProfileChange={handleProfileChange}
      pairingCode={pairingCode}
      copied={copied}
      onCopyPairingCode={() => void copyPairingCode()}
      onRegeneratePairingCode={handleRegeneratePairingCode}
      regeneratePending={regenerateMutation.isPending}
      qrCode={qrCode}
      linkingAfterScan={linkingAfterScan}
      bridgeStarting={bridgeStarting}
      awaitingQr={awaitingQr}
      showReconnect={showReconnect}
      onReconnect={handleReconnect}
      reconnectPending={reconnectMutation.isPending}
      worker={worker}
      statusLine={statusLine}
      formError={formError}
      loadError={loadError}
      canSave={canSave}
      actionLabel={actionLabel}
      onSave={handleSave}
    />
  );

  if (embedded) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
        {content}
      </div>
    );
  }

  return (
    <Card className="w-full shadow-none">
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}
