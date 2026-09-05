import type { UpdateWhatsAppSettingsRequest } from "@nakama/core/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  useProfilesQuery,
  useReconnectWhatsApp,
  useRegenerateWhatsAppPairingCode,
  useSaveWhatsAppSettings,
  useWhatsAppSettings,
} from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import { formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useWhatsAppSettingsCard({
  onSaveSuccess,
  submitLabel,
}: {
  onSaveSuccess?: () => void;
  submitLabel?: string;
}) {
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
  const [allowedPhones, setAllowedPhones] = useState<string[]>([]);
  const [allowedPhonesOpen, setAllowedPhonesOpen] = useState(false);

  const settingsProfileId = settings?.profileId;
  const settingsAllowedPhones = settings?.allowedPhones;

  useEffect(() => {
    if (settingsProfileId !== undefined) {
      setProfileId(settingsProfileId);
    }
  }, [settingsProfileId]);

  useEffect(() => {
    if (settingsAllowedPhones) {
      setAllowedPhones(settingsAllowedPhones);
    }
  }, [settingsAllowedPhones]);

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
  const { headerSubtitle, statusBadge } = resolveWhatsAppStatusCopy({
    awaitingQr,
    bridgeStarting,
    configured,
    linkingAfterScan,
    paired,
    pairingCode,
    running,
    showQr,
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

  return {
    actionLabel,
    allowedPhoneSummary:
      allowedPhones.length === 0
        ? "None"
        : `${allowedPhones.length} number${allowedPhones.length === 1 ? "" : "s"}`,
    allowedPhones,
    allowedPhonesOpen,
    awaitingQr,
    bridgeStarting,
    canSave,
    configured,
    copied,
    formError,
    headerSubtitle,
    isLoading,
    linkedNumber,
    linkingAfterScan,
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
    showQr,
    showReconnect,
    statusBadge,
    statusLine:
      hint ??
      (formError ? formError : null) ??
      (loadError ? formatError(loadError) : null),
    worker,
  };
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
