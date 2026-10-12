import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  useChannelProfileId,
  useReconnectWhatsApp,
  useRegenerateWhatsAppPairingCode,
  useSaveWhatsAppSettings,
  useWhatsAppSettings,
} from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import { useStartWorker } from "@/hooks/use-worker-actions";
import { formatError } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

const NO_PHONE_DETAILS = {};

function formatAllowedPhoneSummary(count: number): string {
  if (count === 0) {
    return "None";
  }

  return `${count} number${count === 1 ? "" : "s"}`;
}

function resolveWhatsAppStatusLine(
  hint: string | null,
  formError: string | null,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error causes may come from browser or network code and are narrowed by this handler.
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

  return "WhatsApp enabled. Preparing the QR code.";
}

export function useWhatsAppSettingsCard({
  onSaveSuccess,
  submitLabel,
}: {
  onSaveSuccess?: () => void;
  submitLabel?: string;
}) {
  const ownerProfileId = useChannelProfileId();
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error: loadError } = useWhatsAppSettings();
  const { data: status } = useSystemStatusQuery();
  const saveMutation = useSaveWhatsAppSettings();
  const startWorkerMutation = useStartWorker();
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

  const [allowUnpairedGroupMembers, setAllowUnpairedGroupMembers] =
    useState(false);

  const settingsProfileId = ownerProfileId ?? settings?.profileId;
  const settingsAllowedPhones = settings?.allowedPhones;
  const settingsRequireGroupMention = settings?.requireGroupMention;
  const settingsAllowUnpairedGroupMembers = settings?.allowUnpairedGroupMembers;

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

  useEffect(() => {
    if (settingsAllowUnpairedGroupMembers !== undefined) {
      setAllowUnpairedGroupMembers(settingsAllowUnpairedGroupMembers);
    }
  }, [settingsAllowUnpairedGroupMembers]);

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
      void invalidateQueries(queryClient, queryKeys.whatsapp.settings);

      return;
    }

    if (worker?.connected && !paired) {
      void invalidateQueries(queryClient, queryKeys.whatsapp.settings);
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
        allowUnpairedGroupMembers,
        profileId: profileId.trim() || "default",
        requireGroupMention,
      },
      {
        onError: (error) => {
          setFormError(formatError(error));
        },
        onSuccess: (saved) => {
          if (configured || running) {
            setHint(hintForSavedSettings(saved, configured));
            onSaveSuccess?.();

            return;
          }

          setHint("Starting WhatsApp…");
          startWorkerMutation.mutate("whatsapp", {
            onError: (error) => {
              setFormError(formatError(error));
            },
            onSuccess: () => {
              setHint("WhatsApp is ready. Scan the QR code.");
              onSaveSuccess?.();
            },
          });
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
        setHint("Scan the new QR code when it appears.");
      },
    });
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

  function handleAllowUnpairedGroupMembersChange(next: boolean) {
    setAllowUnpairedGroupMembers(next);
    setHint(null);
    setFormError(null);

    if (!configured) {
      return;
    }

    saveMutation.mutate(
      { allowUnpairedGroupMembers: next },
      {
        onError: (error) => {
          setAllowUnpairedGroupMembers(!next);
          setFormError(formatError(error));
        },
        onSuccess: () => {
          setHint("Group access setting saved.");
        },
      }
    );
  }

  return {
    actionLabel:
      submitLabel ?? (configured ? "Save changes" : "Connect WhatsApp"),
    allowedPhoneDetails: settings?.allowedPhoneDetails ?? NO_PHONE_DETAILS,
    allowedPhoneSummary: formatAllowedPhoneSummary(allowedPhones.length),
    allowedPhones,
    allowedPhonesOpen,
    allowUnpairedGroupMembers,
    awaitingQr: linking.awaitingQr,
    bridgeStarting: linking.bridgeStarting,
    canSave: linking.canSave,
    configured,
    connected,
    copied,
    formError,
    isLoading,
    linkedNumber: settings?.phoneNumberMasked ?? null,
    linkingAfterScan: linking.linkingAfterScan,
    loadError,
    onAllowedPhonesChange: setAllowedPhones,
    onAllowedPhonesOpenChange: setAllowedPhonesOpen,
    onAllowUnpairedGroupMembersChange: handleAllowUnpairedGroupMembersChange,
    onCopyPairingCode: () => {
      void copyPairingCode();
    },
    onError: setFormError,
    onManageAllowedPhones: () => setAllowedPhonesOpen(true),
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
    qrCode,
    reconnectPending: reconnectMutation.isPending,
    regeneratePending: regenerateMutation.isPending,
    requireGroupMention,
    running,
    savePending: saveMutation.isPending || startWorkerMutation.isPending,
    showQr: linking.showQr,
    showReconnect: linking.showReconnect,
    statusLine: resolveWhatsAppStatusLine(hint, formError, loadError),
    worker,
  };
}
