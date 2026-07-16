import { CheckIcon, CopyIcon, RefreshCwIcon, ScanQrCodeIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SettingsRow } from "@/components/integration-settings.shared";
import { cn } from "@/lib/utils";

export function WhatsAppSettingsLinkingSection({
  paired,
  pairingCode,
  copied,
  savePending,
  regeneratePending,
  onCopyPairingCode,
  onRegeneratePairingCode,
  showQr,
  qrCode,
  linkingAfterScan,
  bridgeStarting,
  awaitingQr,
  showReconnect,
  reconnectPending,
  onReconnect,
}: {
  paired: boolean;
  pairingCode: string | null;
  copied: boolean;
  savePending: boolean;
  regeneratePending: boolean;
  onCopyPairingCode: () => void;
  onRegeneratePairingCode: () => void;
  showQr: boolean;
  qrCode: string | null;
  linkingAfterScan: boolean;
  bridgeStarting: boolean;
  awaitingQr: boolean;
  showReconnect: boolean;
  reconnectPending: boolean;
  onReconnect: () => void;
}) {
  return (
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
  );
}
