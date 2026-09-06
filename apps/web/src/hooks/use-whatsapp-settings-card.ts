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

function formatAllowedPhoneSummary(count: number): string {
  if (count === 0) {
    return "None";
  }
  return `${count} number${count === 1 ? "" : "s"}`;
}

function resolveWhatsAppStatusLine(
  hint: string | null,
  formError: string | null,
  loadError: unknown
): string | null {
  if (hint) {
    return hint;
  }
  if (formError) {
    return formError;
  }
  if (loadError) {
    return formatError(loadError);
  }
  return null;
}

function resolveWhatsAppLinkingState({
  configured,
  connected,
  paired,
  pairingCode,
  profileId,
  qrCode,
  qrWasVisible,
  running,
  settingsProfileId,
}: {
  configured: boolean;
  connected: boolean;
  paired: boolean;
  pairingCode: string | null;
  profileId: string;
  qrCode: string | null;
  qrWasVisible: boolean;
  running: boolean;
  settingsProfileId?: string;
}) {
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

  return {
    awaitingQr,
    bridgeStarting,
    canSave: !configured || profileId !== settingsProfileId,
    linkingAfterScan,
    showQr,
    showReconnect: configured && !showQr && !awaitingQr,
  };
}

function hintForSavedSettings(
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
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [allowedPhones, setAllowedPhones] = useState<string[]>([]);
  const [allowedPhonesOpen, setAllowedPhonesOpen] = useState(false);
  const [requireGroupMention, setRequireGroupMention] = useState(true);

  const settingsProfileId = settings?.profileId;
  const settingsAllowedPhones = settings?.allowedPhones;
  const settingsRequireGroupMention = settings?.requireGroupMention;

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

  useEffect(() => {
    if (settingsRequireGroupMention !== undefined) {
      setRequireGroupMention(settingsRequireGroupMention);
    }
  }, [settingsRequireGroupMention]);

  const configured = settings?.configured === true;
  const worker = status?.whatsappWorker;
  const running = worker?.running === true;
  const connected = worker?.connected === true;
  const qrCode = worker?.qrCode ?? null;
  const paired = Boolean(worker?.paired || settings?.pairedJid);
  const pairingCode = settings?.pairingCode ?? null;
  const copied = copiedCode !== null && copiedCode === pairingCode;

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

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    },
    []
  );

  const linking = resolveWhatsAppLinkingState({
    configured,
    connected,
    paired,
    pairingCode,
    profileId,
    qrCode,
    qrWasVisible,
    running,
    settingsProfileId,
  });
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
      setCopiedCode(pairingCode);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedCode(null);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      setHint("Copy the code manually.");
    }
  }

  function handleSave() {
    setFormError(null);
    setHint(null);
    saveMutation.mutate(
      {
        profileId: profileId.trim() || "default",
        requireGroupMention,
      },
      {
        onError: (error) => {
          setFormError(formatError(error));
        },
        onSuccess: (saved) => {
          setHint(hintForSavedSettings(saved, configured));
          onSaveSuccess?.();
        },
      }
    );
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

  function handleRequireGroupMentionChange(next: boolean) {
    setRequireGroupMention(next);
    setHint(null);
    setFormError(null);

    if (!configured) {
      return;
    }

    saveMutation.mutate(
      { requireGroupMention: next },
      {
        onError: (error) => {
          setRequireGroupMention(!next);
          setFormError(formatError(error));
        },
        onSuccess: () => {
          setHint("Group mention setting saved.");
        },
      }
    );
  }

  return {
    actionLabel: submitLabel ?? (configured ? "Save" : "Enable WhatsApp"),
    allowedPhoneSummary: formatAllowedPhoneSummary(allowedPhones.length),
    allowedPhones,
    allowedPhonesOpen,
    awaitingQr: linking.awaitingQr,
    bridgeStarting: linking.bridgeStarting,
    canSave: linking.canSave,
    configured,
    copied,
    formError,
    headerSubtitle,
    isLoading,
    linkedNumber: settings?.phoneNumberMasked ?? null,
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
    onRequireGroupMentionChange: handleRequireGroupMentionChange,
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
    requireGroupMention,
    running,
    savePending: saveMutation.isPending,
    showQr: linking.showQr,
    showReconnect: linking.showReconnect,
    statusBadge,
    statusLine: resolveWhatsAppStatusLine(hint, formError, loadError),
    worker,
  };
}
