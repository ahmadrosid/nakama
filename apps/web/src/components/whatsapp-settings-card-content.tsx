import type { ProfileSummary } from "@nakama/core/contract";
import { CheckIcon, CopyIcon, RefreshCwIcon, ScanQrCodeIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  IntegrationSettingsFooter,
  IntegrationStatusHeader,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { cn } from "@/lib/utils";

export function WhatsAppSettingsCardContent({
  embedded,
  headerSubtitle,
  statusBadge,
  configured,
  paired,
  running,
  showQr,
  linkedNumber,
  profileId,
  profiles,
  savePending,
  onProfileChange,
  pairingCode,
  copied,
  onCopyPairingCode,
  onRegeneratePairingCode,
  regeneratePending,
  qrCode,
  linkingAfterScan,
  bridgeStarting,
  awaitingQr,
  showReconnect,
  onReconnect,
  reconnectPending,
  worker,
  statusLine,
  formError,
  loadError,
  canSave,
  actionLabel,
  onSave,
}: {
  embedded: boolean;
  headerSubtitle: string;
  statusBadge: string;
  configured: boolean;
  paired: boolean;
  running: boolean;
  showQr: boolean;
  linkedNumber: string | null;
  profileId: string;
  profiles: ProfileSummary[];
  savePending: boolean;
  onProfileChange: (profileId: string) => void;
  pairingCode: string | null;
  copied: boolean;
  onCopyPairingCode: () => void;
  onRegeneratePairingCode: () => void;
  regeneratePending: boolean;
  qrCode: string | null;
  linkingAfterScan: boolean;
  bridgeStarting: boolean;
  awaitingQr: boolean;
  showReconnect: boolean;
  onReconnect: () => void;
  reconnectPending: boolean;
  worker: { process?: { managed?: boolean } } | null | undefined;
  statusLine: string | null;
  formError: string | null;
  loadError: unknown;
  canSave: boolean;
  actionLabel: string;
  onSave: () => void;
}) {
  return (
    <div className="divide-y divide-border">
      {!embedded ? (
        <IntegrationStatusHeader
          title="WhatsApp"
          subtitle={headerSubtitle}
          statusBadge={statusBadge}
          configured={configured}
          connected={paired && running && !showQr}
        />
      ) : null}

      {linkedNumber ? (
        <SettingsRow label="Linked account" description="From your WhatsApp session">
          <span className="text-sm text-foreground">{linkedNumber}</span>
        </SettingsRow>
      ) : null}

      <SettingsRow label="Reply as" description="Which agent answers on WhatsApp">
        <Select
          value={profileId}
          disabled={savePending || profiles.length === 0}
          onValueChange={(value) => {
            if (value) {
              onProfileChange(String(value));
            }
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
                <Button type="button" size="sm" variant="outline" onClick={onCopyPairingCode}>
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
                  disabled={regeneratePending || savePending}
                  onClick={onRegeneratePairingCode}
                >
                  {regeneratePending ? (
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
                disabled={regeneratePending || savePending}
                onClick={onRegeneratePairingCode}
              >
                {regeneratePending ? (
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
                disabled={regeneratePending || savePending}
                onClick={onRegeneratePairingCode}
              >
                {regeneratePending ? (
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
                <li>
                  Tap <strong>Link a Device</strong> and scan this code
                </li>
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
                disabled={reconnectPending || savePending || regeneratePending}
                onClick={onReconnect}
              >
                {reconnectPending ? (
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
        <SettingsRow label="Bridge worker" description={running ? "Running" : "Stopped"}>
          <WorkerActionBar
            workerName="whatsapp"
            running={running}
            pm2Managed={worker?.process?.managed ?? false}
          />
        </SettingsRow>
      ) : null}

      <IntegrationSettingsFooter
        statusLine={statusLine}
        formError={formError}
        loadError={loadError}
        savePending={savePending}
        canSave={canSave}
        submitLabel={actionLabel}
        onSave={onSave}
      />
    </div>
  );
}
