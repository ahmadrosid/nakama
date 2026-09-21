import { Button } from "@nakama/ui/button";
import { ConfirmDialog } from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  CheckmarkCircle01Icon,
  Copy01Icon,
  QrCodeScanIcon,
  RefreshIcon,
} from "hugeicons-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { SettingsRow } from "@/components/integration-settings.shared";

function pairingCodeDescription(
  pairingCode: string | null,
  paired: boolean
): string {
  if (pairingCode) {
    return "Open Linked Devices in WhatsApp and enter this code.";
  }

  if (paired) {
    return "This number is linked. Generate a new code only if you need to relink.";
  }

  return "Optional — use this instead of scanning the QR code.";
}

function WhatsAppPairingCodeControls({
  copied,
  onCopyPairingCode,
  onRegeneratePairingCode,
  paired,
  pairingCode,
  regeneratePending,
  savePending,
}: {
  copied: boolean;
  onCopyPairingCode: () => void;
  onRegeneratePairingCode: () => void;
  paired: boolean;
  pairingCode: string | null;
  regeneratePending: boolean;
  savePending: boolean;
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

function WhatsAppLinkStatus({
  awaitingQr,
  bridgeStarting,
  compact,
  linkingAfterScan,
  qrCode,
  rowClassName,
  showQr,
}: {
  awaitingQr: boolean;
  bridgeStarting: boolean;
  compact: boolean;
  linkingAfterScan: boolean;
  qrCode: string | null;
  rowClassName?: string;
  showQr: boolean;
}) {
  if (showQr) {
    return (
      <div
        className={cn("space-y-3", rowClassName ?? (!compact && "px-4 py-3"))}
      >
        <div className="flex items-center gap-2">
          <QrCodeScanIcon aria-hidden className="size-4 text-primary" />
          <p className="font-medium text-foreground text-sm">Scan QR code</p>
        </div>
        <div className="flex justify-center">
          <div className="inline-flex rounded-xl border border-border bg-white p-3">
            <QRCodeSVG size={180} value={qrCode!} />
          </div>
        </div>
        <ol
          aria-label="Steps to connect WhatsApp"
          className="list-decimal space-y-1 pl-5 text-muted-foreground text-xs"
        >
          <li>
            <strong>Open WhatsApp</strong> on your phone
          </li>
          <li>
            Open <strong>Settings</strong>, then <strong>Linked Devices</strong>
          </li>
          <li>
            Tap <strong>Link a Device</strong>, then scan this QR code
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
          rowClassName ?? (!compact && "px-4 py-3")
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
          rowClassName ?? (!compact && "px-4 py-3")
        )}
      >
        <Spinner className="size-4" />
        Connecting — enter the code in WhatsApp
      </div>
    );
  }

  if (awaitingQr) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-muted-foreground text-sm",
          rowClassName ?? (!compact && "px-4 py-3")
        )}
      >
        <Spinner className="size-4" />
        Preparing QR code…
      </div>
    );
  }

  return null;
}

function WhatsAppReconnectRow({
  onReconnect,
  paired,
  reconnectPending,
  regeneratePending,
  rowClassName,
  savePending,
}: {
  onReconnect: () => void;
  paired: boolean;
  reconnectPending: boolean;
  regeneratePending: boolean;
  rowClassName?: string;
  savePending: boolean;
}) {
  return (
    <SettingsRow
      className={rowClassName}
      description={
        paired
          ? "Disconnects this account until you scan the new QR code"
          : "Try linking your account again with a QR code"
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
            Scan a new QR code
          </>
        )}
      </Button>
    </SettingsRow>
  );
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
  const [relinkMethod, setRelinkMethod] = useState<"code" | "qr" | null>(null);
  return (
    <div className="divide-y divide-border border-border border-t">
      {relinkMethod ? (
        <ConfirmDialog
          confirmLabel="Relink WhatsApp"
          description="This will disconnect the current account. Your agent cannot receive WhatsApp messages until you link it again."
          onClose={() => setRelinkMethod(null)}
          onConfirm={async () => {
            if (relinkMethod === "code") {
              onRegeneratePairingCode();
            } else {
              onReconnect();
            }
          }}
          title="Relink WhatsApp?"
        />
      ) : null}
      <WhatsAppLinkStatus
        awaitingQr={awaitingQr}
        bridgeStarting={bridgeStarting}
        compact={compact}
        linkingAfterScan={linkingAfterScan}
        qrCode={qrCode}
        rowClassName={rowClassName}
        showQr={showQr}
      />
      <details
        className="px-4 py-3 text-sm"
        open={paired || Boolean(pairingCode)}
      >
        <summary className="cursor-pointer text-muted-foreground">
          Link with a code instead
        </summary>
        <SettingsRow
          className={rowClassName}
          description={pairingCodeDescription(pairingCode, paired)}
          label="Link with a code"
        >
          <WhatsAppPairingCodeControls
            copied={copied}
            onCopyPairingCode={onCopyPairingCode}
            onRegeneratePairingCode={() =>
              paired ? setRelinkMethod("code") : onRegeneratePairingCode()
            }
            paired={paired}
            pairingCode={pairingCode}
            regeneratePending={regeneratePending}
            savePending={savePending}
          />
        </SettingsRow>

        {pairingCode ? (
          <ol
            aria-label="Steps to connect WhatsApp with a pairing code"
            className={cn(
              "list-decimal space-y-1 pl-5 text-muted-foreground text-xs",
              !compact && "px-4 py-3 pl-8"
            )}
          >
            <li>
              <strong>Open WhatsApp</strong> on your phone
            </li>
            <li>
              Open <strong>Settings</strong>, then{" "}
              <strong>Linked Devices</strong>
            </li>
            <li>
              Choose <strong>Link with phone number</strong> and enter this code
            </li>
          </ol>
        ) : null}
      </details>

      {showReconnect ? (
        <WhatsAppReconnectRow
          onReconnect={() => (paired ? setRelinkMethod("qr") : onReconnect())}
          paired={paired}
          reconnectPending={reconnectPending}
          regeneratePending={regeneratePending}
          rowClassName={rowClassName}
          savePending={savePending}
        />
      ) : null}
    </div>
  );
}
