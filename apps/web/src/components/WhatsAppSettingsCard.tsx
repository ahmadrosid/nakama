import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UpdateWhatsAppSettingsRequest } from "@nakama/core/contract";
import { CheckIcon, CopyIcon, RefreshCwIcon, ScanQrCodeIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useQueryClient } from "@tanstack/react-query";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
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
import { cn } from "@/lib/utils";

interface WhatsAppSettingsCardProps {
  embedded?: boolean;
  submitLabel?: string;
  onSaveSuccess?: () => void;
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
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
  const profileChanged = configured && profileId !== settings?.profileId;
  const canSave = !configured || profileChanged;
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
    <div className="divide-y divide-border">
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">WhatsApp</p>
            <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium",
              paired && running && !showQr
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                : configured
                  ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100"
                  : "border-border bg-muted text-muted-foreground",
            )}
          >
            {statusBadge}
          </span>
        </div>
      ) : null}

      {linkedNumber ? (
        <SettingsRow label="Linked account" description="From your WhatsApp session">
          <span className="text-sm text-foreground">{linkedNumber}</span>
        </SettingsRow>
      ) : null}

      <SettingsRow label="Reply as" description="Which agent answers on WhatsApp">
        <Select
          value={profileId}
          disabled={saveMutation.isPending || profiles.length === 0}
          onValueChange={(value) => {
            if (!value) {
              return;
            }

            const nextProfileId = String(value);
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
          }}
        >
          <SelectTrigger id="whatsapp-profile" className="w-[11rem] sm:w-[13rem]">
            <SelectValue placeholder="Profile">
              {profiles.find((profile) => profile.id === profileId)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                <span className="flex items-center gap-2">
                  <ProfileAvatar profile={profile} size="sm" />
                  <span>{profile.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {configured ? (
        <div className={cn("divide-y divide-border", !paired && "bg-muted/20")}>
          <SettingsRow
            label="Pairing code"
            description={
              pairingCode
                ? "Open Linked Devices in WhatsApp and enter this code."
                : paired
                  ? "This number is linked. Generate a new code only if you need to relink."
                  : "Optional — use this instead of scanning the QR code."
            }
          >
            {pairingCode ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <code className="rounded-md border border-border bg-background px-2.5 py-1 text-sm tracking-widest">
                  {pairingCode}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void copyPairingCode()}
                >
                  {copied ? (
                    <CheckIcon
                      className="size-3.5 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <CopyIcon className="size-3.5" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={regenerateMutation.isPending || saveMutation.isPending}
                  onClick={handleRegeneratePairingCode}
                >
                  {regenerateMutation.isPending ? (
                    <Spinner />
                  ) : (
                    <>
                      <RefreshCwIcon className="size-3.5" aria-hidden="true" />
                      New code
                    </>
                  )}
                </Button>
              </div>
            ) : paired ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={regenerateMutation.isPending || saveMutation.isPending}
                onClick={handleRegeneratePairingCode}
              >
                {regenerateMutation.isPending ? (
                  <Spinner />
                ) : (
                  <>
                    <RefreshCwIcon className="size-3.5" aria-hidden="true" />
                    New code
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={regenerateMutation.isPending || saveMutation.isPending}
                onClick={handleRegeneratePairingCode}
              >
                {regenerateMutation.isPending ? (
                  <>
                    <Spinner className="mr-2" />
                    Generating…
                  </>
                ) : (
                  "Generate pairing code"
                )}
              </Button>
            )}
          </SettingsRow>

          {pairingCode ? (
            <ol className="list-decimal space-y-1 px-4 py-3 pl-8 text-xs text-muted-foreground">
              <li>Open WhatsApp on your phone</li>
              <li>Go to Settings, then Linked Devices</li>
              <li>Choose Link with phone number and enter this code</li>
            </ol>
          ) : null}

          {showQr ? (
            <div className="space-y-3 px-4 py-4">
              <div className="flex items-center gap-2">
                <ScanQrCodeIcon className="size-4 text-primary" aria-hidden />
                <p className="text-sm font-medium text-foreground">Scan QR code</p>
              </div>
              <div className="flex justify-center">
                <div className="inline-flex rounded-xl border border-border bg-white p-3">
                  <QRCodeSVG value={qrCode!} size={180} />
                </div>
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Open WhatsApp on your phone</li>
                <li>Go to Settings, then Linked Devices</li>
                <li>Tap <strong>Link a Device</strong> and scan this code</li>
              </ol>
            </div>
          ) : linkingAfterScan ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Linking your WhatsApp account…
            </div>
          ) : bridgeStarting ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Bridge starting — enter the pairing code in WhatsApp
            </div>
          ) : awaitingQr ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Preparing QR code…
            </div>
          ) : null}

          {showReconnect ? (
            <SettingsRow
              label="Reconnect"
              description={
                paired
                  ? "Unlinks the current session so you can scan a new QR code"
                  : "Clears a stuck session so you can link again with a QR code"
              }
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  reconnectMutation.isPending ||
                  saveMutation.isPending ||
                  regenerateMutation.isPending
                }
                onClick={handleReconnect}
              >
                {reconnectMutation.isPending ? (
                  <>
                    <Spinner className="mr-2" />
                    Resetting…
                  </>
                ) : (
                  <>
                    <ScanQrCodeIcon className="size-3.5" aria-hidden="true" />
                    Reconnect with QR
                  </>
                )}
              </Button>
            </SettingsRow>
          ) : null}
        </div>
      ) : null}

      {configured ? (
        <SettingsRow
          label="Bridge worker"
          description={running ? "Running" : "Stopped"}
        >
          <WorkerActionBar
            workerName="whatsapp"
            running={running}
            pm2Managed={worker?.process?.managed ?? false}
          />
        </SettingsRow>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        {statusLine ? (
          <p
            className={cn(
              "min-w-0 text-xs",
              formError || loadError ? "text-destructive" : "text-emerald-200",
            )}
            role={formError || loadError ? "alert" : "status"}
          >
            {statusLine}
          </p>
        ) : (
          <span />
        )}
        <Button
          type="button"
          size="sm"
          disabled={saveMutation.isPending || !canSave}
          onClick={handleSave}
        >
          {saveMutation.isPending ? (
            <>
              <Spinner className="mr-2" />
              Saving…
            </>
          ) : (
            actionLabel
          )}
        </Button>
      </div>
    </div>
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
