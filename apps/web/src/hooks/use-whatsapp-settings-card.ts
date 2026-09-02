import type { UpdateWhatsAppSettingsRequest } from "@nakama/core/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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

function resolveWhatsAppLinkingFlags(input: {
  configured: boolean;
  connected: boolean;
  paired: boolean;
  pairingCode: string | null;
  qrCode: string | null;
  qrWasVisible: boolean;
  running: boolean;
}) {
  const useQrLinking = !input.pairingCode;
  const showQr =
    input.configured && input.running && Boolean(input.qrCode) && useQrLinking;
  const awaitingQr =
    input.configured &&
    !input.paired &&
    input.running &&
    !input.connected &&
    !input.qrCode &&
    !input.qrWasVisible &&
    useQrLinking;
  const bridgeStarting =
    input.configured &&
    !input.paired &&
    input.running &&
    !input.connected &&
    Boolean(input.pairingCode);
  const linkingAfterScan =
    input.configured &&
    !input.paired &&
    input.running &&
    !input.qrCode &&
    (input.qrWasVisible || input.connected) &&
    useQrLinking;
  const showReconnect = input.configured && !showQr && !awaitingQr;

  return {
    awaitingQr,
    bridgeStarting,
    linkingAfterScan,
    showQr,
    showReconnect,
  };
}

function whatsAppSaveHint(
  saved: { pairedJid?: string | null; pairingCode?: string | null },
  configured: boolean
): string {
  if (saved.pairedJid) {
    return "Saved.";
  }

  if (saved.pairingCode) {
    return "Saved. Use the pairing code in WhatsApp.";
  }

  if (configured) {
    return "Saved.";
  }

  return "Enabled. Start the bridge and scan the QR code.";
}

function allowedPhoneSummaryLabel(count: number): string {
  if (count === 0) {
    return "None";
  }
  return `${count} number${count === 1 ? "" : "s"}`;
}

function resolveWhatsAppStatusCopy(input: {
  awaitingQr: boolean;
  bridgeStarting: boolean;
  configured: boolean;
  linkingAfterScan: boolean;
  paired: boolean;
  pairingCode: string | null;
  running: boolean;
  showQr: boolean;
}): { headerSubtitle: string; statusBadge: string } {
  if (!input.configured) {
    return {
      headerSubtitle: "Choose a profile and enable WhatsApp to get started",
      statusBadge: "Not set up",
    };
  }

  if (input.paired && input.running && !input.showQr) {
    return {
      headerSubtitle: "WhatsApp is linked and the bridge is running",
      statusBadge: "Connected",
    };
  }

  if (input.paired && !input.running) {
    return {
      headerSubtitle: "Linked. Start the WhatsApp bridge to receive messages",
      statusBadge: "Paired",
    };
  }

  if (input.showQr) {
    return {
      headerSubtitle: "Scan the QR code with WhatsApp to link your device",
      statusBadge: "Awaiting scan",
    };
  }

  if (input.linkingAfterScan) {
    return {
      headerSubtitle: "Linking your WhatsApp account…",
      statusBadge: "Linking",
    };
  }

  if (input.bridgeStarting) {
    return {
      headerSubtitle: "Bridge starting — enter the pairing code in WhatsApp",
      statusBadge: "Starting…",
    };
  }

  if (input.awaitingQr) {
    return {
      headerSubtitle: "Preparing QR code…",
      statusBadge: "Starting…",
    };
  }

  if (input.pairingCode) {
    return {
      headerSubtitle: "Enter the pairing code in WhatsApp",
      statusBadge: "Awaiting link",
    };
  }

  return {
    headerSubtitle: "Scan the QR code, or generate a pairing code",
    statusBadge: "Not linked",
  };
}

function useWhatsAppSettingsSync(input: {
  pairingCode: string | null;
  paired: boolean;
  qrCode: string | null;
  settingsPairedJid: string | null | undefined;
  workerConnected: boolean | undefined;
  workerPaired: boolean | undefined;
  setCopied: (copied: boolean) => void;
  setQrWasVisible: (visible: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (input.qrCode) {
      input.setQrWasVisible(true);
    }
    if (input.paired) {
      input.setQrWasVisible(false);
    }
  }, [input.qrCode, input.paired, input.setQrWasVisible]);

  useEffect(() => {
    if (input.workerPaired && !input.settingsPairedJid) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.whatsapp.settings,
      });
      return;
    }

    if (input.workerConnected && !input.paired) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.whatsapp.settings,
      });
    }
  }, [
    input.workerPaired,
    input.workerConnected,
    input.settingsPairedJid,
    input.paired,
    queryClient,
  ]);

  useEffect(() => {
    input.setCopied(false);
  }, [input.pairingCode, input.setCopied]);

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    },
    []
  );

  return copyTimeoutRef;
}

export function useWhatsAppSettingsCard({
  onSaveSuccess,
  submitLabel,
}: {
  onSaveSuccess?: () => void;
  submitLabel?: string;
}) {
  const { data: settings, isLoading, error: loadError } = useWhatsAppSettings();
  const { data: status } = useSystemStatusQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const saveMutation = useSaveWhatsAppSettings();
  const regenerateMutation = useRegenerateWhatsAppPairingCode();
  const reconnectMutation = useReconnectWhatsApp();

  const [profileId, setProfileId] = useState("default");
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [qrWasVisible, setQrWasVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [allowedPhones, setAllowedPhones] = useState<string[]>([]);
  const [allowedPhonesOpen, setAllowedPhonesOpen] = useState(false);

  const configured = settings?.configured === true;
  const worker = status?.whatsappWorker;
  const running = worker?.running === true;
  const connected = worker?.connected === true;
  const qrCode = worker?.qrCode ?? null;
  const paired = Boolean(worker?.paired || settings?.pairedJid);
  const pairingCode = settings?.pairingCode ?? null;
  const linkedNumber = settings?.phoneNumberMasked ?? null;

  // Keep draft fields in this hook (owner of the state), not via child-hook setters.
  useEffect(() => {
    if (settings?.profileId !== undefined) {
      setProfileId(settings.profileId);
    }
  }, [settings?.profileId]);

  useEffect(() => {
    if (settings?.allowedPhones) {
      setAllowedPhones(settings.allowedPhones);
    }
  }, [settings?.allowedPhones]);

  const copyTimeoutRef = useWhatsAppSettingsSync({
    paired,
    pairingCode,
    qrCode,
    setCopied,
    setQrWasVisible,
    settingsPairedJid: settings?.pairedJid,
    workerConnected: worker?.connected,
    workerPaired: worker?.paired,
  });

  const linking = resolveWhatsAppLinkingFlags({
    configured,
    connected,
    paired,
    pairingCode,
    qrCode,
    qrWasVisible,
    running,
  });
  const canSave = !configured || profileId !== settings?.profileId;
  const actionLabel = submitLabel ?? (configured ? "Save" : "Enable WhatsApp");
  const { headerSubtitle, statusBadge } = resolveWhatsAppStatusCopy({
    awaitingQr: linking.awaitingQr,
    bridgeStarting: linking.bridgeStarting,
    configured,
    linkingAfterScan: linking.linkingAfterScan,
    paired,
    pairingCode,
    running,
    showQr: linking.showQr,
  });

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
        setHint(whatsAppSaveHint(saved, configured));
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

  return {
    actionLabel,
    allowedPhoneSummary: allowedPhoneSummaryLabel(allowedPhones.length),
    allowedPhones,
    allowedPhonesOpen,
    awaitingQr: linking.awaitingQr,
    bridgeStarting: linking.bridgeStarting,
    canSave,
    configured,
    copied,
    formError,
    headerSubtitle,
    isLoading,
    linkedNumber,
    linkingAfterScan: linking.linkingAfterScan,
    loadError,
    onAllowedPhonesChange: setAllowedPhones,
    onAllowedPhonesOpenChange: setAllowedPhonesOpen,
    onCopyPairingCode: () => {
      void copyPairingCode();
    },
    onError: setFormError,
    onManageAllowedPhones: () => setAllowedPhonesOpen(true),
    onProfileChange: handleProfileChange,
    onReconnect: handleReconnect,
    onRegeneratePairingCode: handleRegeneratePairingCode,
    onSave: handleSave,
    onSavedAllowedPhones: () => {
      setHint("Allowed numbers saved.");
      setFormError(null);
    },
    paired,
    pairingCode,
    profileId,
    profiles,
    qrCode,
    reconnectPending: reconnectMutation.isPending,
    regeneratePending: regenerateMutation.isPending,
    running,
    savePending: saveMutation.isPending,
    showQr: linking.showQr,
    showReconnect: linking.showReconnect,
    statusBadge,
    statusLine:
      hint ??
      (formError ? formError : null) ??
      (loadError ? formatError(loadError) : null),
    worker,
  };
}
