import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  QrCodeScanIcon,
  RefreshIcon,
} from "hugeicons-react";
import { QRCodeSVG } from "qrcode.react";
import { SettingsRow } from "@/components/integration-settings.shared";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

function pairingCodeDescription(
  pairingCode: string | null,
  paired: boolean
): string {
  if (pairingCode) {
    return "Open Linked Devices in WhatsApp and enter this code.";
  }

  return paired
    ? "This number is linked. Generate a new code only if you need to relink."
    : "Optional — use this instead of scanning the QR code.";
}

function WhatsAppPairingCodeControls({
  pairingCode,
  paired,
  copied,
  savePending,
  regeneratePending,
  onCopyPairingCode,
  onRegeneratePairingCode,
}: {
  pairingCode: string | null;
  paired: boolean;
  copied: boolean;
  savePending: boolean;
  regeneratePending: boolean;
  onCopyPairingCode: () => void;
  onRegeneratePairingCode: () => void;
}) {
  if (pairingCode) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <code className="rounded-md border border-border bg-background px-2.5 py-1 text-sm tracking-widest">
          {pairingCode}
        </code>
        <Button
          onClick={onCopyPairingCode}
          size="sm"
          type="button"
          variant="outline"
        >
          {copied ? (
            <CheckmarkCircle01Icon
              aria-hidden
              className="size-3.5 text-emerald-600 dark:text-emerald-400"
            />
          ) : (
            <Copy01Icon aria-hidden className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          disabled={regeneratePending || savePending}
          onClick={onRegeneratePairingCode}
          size="sm"
          type="button"
          variant="outline"
        >
          {regeneratePending ? (
            <Spinner />
          ) : (
            <>
              <RefreshIcon aria-hidden="true" className="size-3.5" />
              New code
            </>
          )}
        </Button>
      </div>
    );
  }

  if (paired) {
    return (
      <Button
        disabled={regeneratePending || savePending}
        onClick={onRegeneratePairingCode}
        size="sm"
        type="button"
        variant="outline"
      >
        {regeneratePending ? (
          <Spinner />
        ) : (
          <>
            <RefreshIcon aria-hidden="true" className="size-3.5" />
            New code
          </>
        )}
      </Button>
    );
  }

  return (
    <Button
      disabled={regeneratePending || savePending}
      onClick={onRegeneratePairingCode}
      size="sm"
      type="button"
      variant="outline"
    >
      {regeneratePending ? (
        <>
          <Spinner className="size-3" />
          Generating…
        </>
      ) : (
        "Generate pairing code"
      )}
    </Button>
  );
}

function WhatsAppQrStatusPanel({
  showQr,
  qrCode,
  linkingAfterScan,
  bridgeStarting,
  awaitingQr,
  compact,
}: {
  showQr: boolean;
  qrCode: string | null;
  linkingAfterScan: boolean;
  bridgeStarting: boolean;
  awaitingQr: boolean;
  compact: boolean;
}) {
  if (showQr) {
    return (
      <div className={cn("space-y-3", !compact && "px-4 py-4")}>
        <div className="flex items-center gap-2">
          <QrCodeScanIcon aria-hidden className="size-4 text-primary" />
          <p className="font-medium text-foreground text-sm">Scan QR code</p>
        </div>
        <div className="flex justify-center">
          <div className="inline-flex rounded-xl border border-border bg-white p-3">
            <QRCodeSVG size={180} value={qrCode!} />
          </div>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground text-xs">
          <li>Open WhatsApp on your phone</li>
          <li>Go to Settings, then Linked Devices</li>
          <li>
            Tap <strong>Link a Device</strong> and scan this code
          </li>
        </ol>
      </div>
    );
  }

  if (linkingAfterScan) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-muted-foreground text-sm",
          !compact && "px-4 py-4"
        )}
      >
        <Spinner className="size-4" />
        Linking your WhatsApp account…
      </div>
    );
  }

  if (bridgeStarting) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-muted-foreground text-sm",
          !compact && "px-4 py-4"
        )}
      >
        <Spinner className="size-4" />
        Bridge starting — enter the pairing code in WhatsApp
      </div>
    );
  }

  if (awaitingQr) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-muted-foreground text-sm",
          !compact && "px-4 py-4"
        )}
      >
        <Spinner className="size-4" />
        Preparing QR code…
      </div>
    );
  }

  return null;
}

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
  rowClassName,
  compact = false,
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
  rowClassName?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-4", !paired && "bg-muted/20")}>
      <SettingsRow
        className={rowClassName}
        description={pairingCodeDescription(pairingCode, paired)}
        label="Pairing code"
      >
        <WhatsAppPairingCodeControls
          copied={copied}
          onCopyPairingCode={onCopyPairingCode}
          onRegeneratePairingCode={onRegeneratePairingCode}
          paired={paired}
          pairingCode={pairingCode}
          regeneratePending={regeneratePending}
          savePending={savePending}
        />
      </SettingsRow>

      {pairingCode ? (
        <ol
          className={cn(
            "list-decimal space-y-1 pl-5 text-muted-foreground text-xs",
            !compact && "px-4 py-3 pl-8"
          )}
        >
          <li>Open WhatsApp on your phone</li>
          <li>Go to Settings, then Linked Devices</li>
          <li>Choose Link with phone number and enter this code</li>
        </ol>
      ) : null}

      <WhatsAppQrStatusPanel
        awaitingQr={awaitingQr}
        bridgeStarting={bridgeStarting}
        compact={compact}
        linkingAfterScan={linkingAfterScan}
        qrCode={qrCode}
        showQr={showQr}
      />

      {showReconnect ? (
        <SettingsRow
          className={rowClassName}
          description={
            paired
              ? "Unlinks the current session so you can scan a new QR code"
              : "Clears a stuck session so you can link again with a QR code"
          }
          label="Reconnect"
        >
          <Button
            disabled={reconnectPending || savePending || regeneratePending}
            onClick={onReconnect}
            size="sm"
            type="button"
            variant="outline"
          >
            {reconnectPending ? (
              <>
                <Spinner className="size-3" />
                Resetting…
              </>
            ) : (
              <>
                <QrCodeScanIcon aria-hidden="true" className="size-3.5" />
                Reconnect with QR
              </>
            )}
          </Button>
        </SettingsRow>
      ) : null}
    </div>
  );
}
