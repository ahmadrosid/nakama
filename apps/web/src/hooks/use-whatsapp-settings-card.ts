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

function useWhatsAppSettingsFormState(
  settings:
    | {
        allowedPhones?: string[];
        profileId?: string;
      }
    | null
    | undefined
) {
  const [profileId, setProfileId] = useState("default");
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

  return {
    allowedPhones,
    allowedPhonesOpen,
    profileId,
    setAllowedPhones,
    setAllowedPhonesOpen,
    setProfileId,
    settingsProfileId,
  };
}

function useWhatsAppQrVisibility(qrCode: string | null, paired: boolean) {
  const [qrWasVisible, setQrWasVisible] = useState(false);

  useEffect(() => {
    if (qrCode) {
      setQrWasVisible(true);
    }
    if (paired) {
      setQrWasVisible(false);
    }
  }, [qrCode, paired]);

  return { qrWasVisible, setQrWasVisible };
}

function useWhatsAppSettingsSync(
  worker: { connected?: boolean; paired?: boolean } | undefined,
  pairedJid: string | undefined,
  paired: boolean
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (worker?.paired && !pairedJid) {
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
  }, [worker?.paired, worker?.connected, pairedJid, paired, queryClient]);
}

function useWhatsAppPairingCopy(
  pairingCode: string | null,
  setHint: (hint: string | null) => void
) {
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);

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

  return {
    copied,
    onCopyPairingCode: () => {
      void copyPairingCode();
    },
  };
}

function useWhatsAppSettingsActions({
  configured,
  onSaveSuccess,
  profileId,
  setProfileId,
  setQrWasVisible,
  settingsProfileId,
}: {
  configured: boolean;
  onSaveSuccess?: () => void;
  profileId: string;
  setProfileId: (profileId: string) => void;
  setQrWasVisible: (value: boolean) => void;
  settingsProfileId?: string;
}) {
  const saveMutation = useSaveWhatsAppSettings();
  const regenerateMutation = useRegenerateWhatsAppPairingCode();
  const reconnectMutation = useReconnectWhatsApp();
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function clearMessages() {
    setFormError(null);
    setHint(null);
  }

  function handleSave() {
    clearMessages();
    const request: UpdateWhatsAppSettingsRequest = {
      profileId: profileId.trim() || "default",
    };

    saveMutation.mutate(request, {
      onError: (error) => {
        setFormError(formatError(error));
      },
      onSuccess: (saved) => {
        setHint(hintForSavedSettings(saved, configured));
        onSaveSuccess?.();
      },
    });
  }

  function handleRegeneratePairingCode() {
    clearMessages();
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
    clearMessages();
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
    clearMessages();

    if (!configured || nextProfileId === settingsProfileId) {
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
    formError,
    handleProfileChange,
    handleReconnect,
    handleRegeneratePairingCode,
    handleSave,
    hint,
    reconnectPending: reconnectMutation.isPending,
    regeneratePending: regenerateMutation.isPending,
    savePending: saveMutation.isPending,
    setFormError,
    setHint,
  };
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
  const form = useWhatsAppSettingsFormState(settings);
  const configured = settings?.configured === true;
  const worker = status?.whatsappWorker;
  const running = worker?.running === true;
  const connected = worker?.connected === true;
  const qrCode = worker?.qrCode ?? null;
  const paired = Boolean(worker?.paired || settings?.pairedJid);
  const pairingCode = settings?.pairingCode ?? null;
  const { qrWasVisible, setQrWasVisible } = useWhatsAppQrVisibility(
    qrCode,
    paired
  );
  const actions = useWhatsAppSettingsActions({
    configured,
    onSaveSuccess,
    profileId: form.profileId,
    setProfileId: form.setProfileId,
    setQrWasVisible,
    settingsProfileId: form.settingsProfileId,
  });
  useWhatsAppSettingsSync(worker, settings?.pairedJid ?? undefined, paired);
  const { copied, onCopyPairingCode } = useWhatsAppPairingCopy(
    pairingCode,
    actions.setHint
  );
  const linking = resolveWhatsAppLinkingState({
    configured,
    connected,
    paired,
    pairingCode,
    profileId: form.profileId,
    qrCode,
    qrWasVisible,
    running,
    settingsProfileId: form.settingsProfileId,
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

  return {
    actionLabel: submitLabel ?? (configured ? "Save" : "Enable WhatsApp"),
    allowedPhoneSummary: formatAllowedPhoneSummary(form.allowedPhones.length),
    allowedPhones: form.allowedPhones,
    allowedPhonesOpen: form.allowedPhonesOpen,
    awaitingQr: linking.awaitingQr,
    bridgeStarting: linking.bridgeStarting,
    canSave: linking.canSave,
    configured,
    copied,
    formError: actions.formError,
    headerSubtitle,
    isLoading,
    linkedNumber: settings?.phoneNumberMasked ?? null,
    linkingAfterScan: linking.linkingAfterScan,
    loadError,
    onAllowedPhonesChange: form.setAllowedPhones,
    onAllowedPhonesOpenChange: form.setAllowedPhonesOpen,
    onCopyPairingCode,
    onError: actions.setFormError,
    onManageAllowedPhones: () => form.setAllowedPhonesOpen(true),
    onProfileChange: actions.handleProfileChange,
    onReconnect: actions.handleReconnect,
    onRegeneratePairingCode: actions.handleRegeneratePairingCode,
    onSave: actions.handleSave,
    onSavedAllowedPhones: () => {
      actions.setHint("Allowed numbers saved.");
      actions.setFormError(null);
    },
    paired,
    pairingCode,
    profileId: form.profileId,
    profiles,
    qrCode,
    reconnectPending: actions.reconnectPending,
    regeneratePending: actions.regeneratePending,
    running,
    savePending: actions.savePending,
    showQr: linking.showQr,
    showReconnect: linking.showReconnect,
    statusBadge,
    statusLine: resolveWhatsAppStatusLine(
      actions.hint,
      actions.formError,
      loadError
    ),
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
