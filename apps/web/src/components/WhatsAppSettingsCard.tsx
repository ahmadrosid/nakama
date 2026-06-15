import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UpdateWhatsAppSettingsRequest } from "@tinyclaw/core/contract";
import { ClipboardPasteIcon, CopyIcon, RefreshCwIcon, ScanQrCodeIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
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
  useSaveWhatsAppSettings,
  useWhatsAppSettings,
} from "@/hooks/use-whatsapp-settings";
import { formatError } from "@/lib/client";
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
  submitLabel = "Save",
  onSaveSuccess,
}: WhatsAppSettingsCardProps) {
  const { data: settings, isLoading, error: loadError } = useWhatsAppSettings();
  const { data: status } = useSystemStatusQuery();
  const { data: profiles = [] } = useProfilesQuery();
  const saveMutation = useSaveWhatsAppSettings();
  const regenerateMutation = useRegenerateWhatsAppPairingCode();

  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [profileId, setProfileId] = useState("profile_default");
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setProfileId(settings.profileId);
  }, [settings?.profileId]);

  const configured = settings?.configured === true;
  const paired = Boolean(settings?.pairedJid);
  const pairingCode = settings?.pairingCode ?? null;
  const worker = status?.whatsappWorker;
  const running = worker?.running === true;
  const qrCode = worker?.qrCode ?? null;
  const canSave = configured || phoneDraft.trim().length > 0;
  const showQr = configured && !paired && running && qrCode;

  const statusLine =
    hint ?? (formError ? formError : null) ?? (loadError ? formatError(loadError) : null);

  const headerSubtitle = !configured
    ? "Step 1: paste the phone number for your WhatsApp account"
    : paired && running
      ? "WhatsApp is linked and the bridge is running"
      : paired
        ? "Linked. Start the WhatsApp bridge to receive messages"
        : showQr
          ? "Scan the QR code with WhatsApp to link your device"
          : pairingCode
            ? "Step 2: link this number from WhatsApp with the pairing code"
            : "Step 2: generate a pairing code to finish linking";

  const statusBadge = !configured
    ? "Not set up"
    : paired && running
      ? "Connected"
      : paired
        ? "Paired"
        : pairingCode
          ? "Awaiting link"
          : "Needs code";

  async function copyPairingCode() {
    if (!pairingCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pairingCode);
      setHint("Code copied.");
    } catch {
      setHint("Copy the code manually.");
    }
  }

  function readPhoneDraft(): string {
    return phoneInputRef.current?.value.trim() ?? phoneDraft.trim();
  }

  function clearPhoneInput() {
    if (phoneInputRef.current) {
      phoneInputRef.current.value = "";
    }
    setPhoneDraft("");
  }

  function markPhoneDirty(value: string) {
    setPhoneDraft(value);
    setHint(null);
    if (formError) {
      setFormError(null);
    }
  }

  async function pastePhoneFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) {
        setHint("Clipboard is empty.");
        return;
      }

      if (phoneInputRef.current) {
        phoneInputRef.current.value = trimmed;
        phoneInputRef.current.focus();
      }
      markPhoneDirty(trimmed);
    } catch {
      setHint("Use ⌘V to paste, or allow clipboard access.");
    }
  }

  function handleSave() {
    setFormError(null);
    setHint(null);

    const request: UpdateWhatsAppSettingsRequest = {
      profileId: profileId.trim() || "profile_default",
    };

    const phoneNumber = readPhoneDraft();
    if (phoneNumber) {
      request.phoneNumber = phoneNumber;
    }

    saveMutation.mutate(request, {
      onSuccess: (saved) => {
        clearPhoneInput();
        if (saved.pairedJid) {
          setHint("Saved.");
        } else if (saved.pairingCode) {
          setHint("Saved. Use the pairing code in WhatsApp.");
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

  if (isLoading) {
    const skeleton = (
      <div className="h-16 animate-pulse rounded-lg bg-muted px-4" aria-hidden="true" />
    );

    if (embedded) {
      return skeleton;
    }

    return (
      <Card className="w-full">
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
              paired && running
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

      <SettingsRow
        label="Phone number"
        description="Use the number linked to your WhatsApp account"
      >
        <InputGroup className="w-full min-w-[12rem] sm:w-[16rem]">
          <input
            ref={phoneInputRef}
            id="whatsapp-phone-number"
            data-slot="input-group-control"
            type="text"
            inputMode="tel"
            autoComplete="tel"
            placeholder={
              configured && settings?.phoneNumberMasked
                ? `Saved (${settings.phoneNumberMasked})`
                : "Phone number"
            }
            defaultValue=""
            disabled={saveMutation.isPending}
            className="h-8 w-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-transparent"
            onInput={(event) => {
              markPhoneDirty(event.currentTarget.value);
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              aria-label="Paste phone number"
              disabled={saveMutation.isPending}
              onClick={() => void pastePhoneFromClipboard()}
            >
              <ClipboardPasteIcon className="size-3.5" aria-hidden="true" />
              Paste
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
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
                  : "Generate a code, then enter it in WhatsApp."
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
                  <CopyIcon className="size-4" />
                  Copy
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
                  <QRCodeSVG value={qrCode} size={180} />
                </div>
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Open WhatsApp on your phone</li>
                <li>Go to Settings, then Linked Devices</li>
                <li>Tap <strong>Link a Device</strong> and scan this code</li>
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      {configured ? (
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
                { profileId: nextProfileId.trim() || "profile_default" },
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
        ) : configured ? (
          <p className="min-w-0 text-xs text-muted-foreground">
            Run `bun run dev:whatsapp` after saving if the bridge is not running.
          </p>
        ) : (
          <span className="text-xs text-muted-foreground" />
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
            submitLabel
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
    <Card className="w-full">
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}
