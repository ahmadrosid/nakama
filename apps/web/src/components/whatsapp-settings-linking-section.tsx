import { Button } from "@nakama/ui/button";
import { ConfirmDialog } from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Copy01Icon,
  QrCodeScanIcon,
  RefreshIcon,
} from "hugeicons-react";
import { QRCodeSVG } from "qrcode.react";
import { type ReactNode, useState } from "react";
import { SettingsRow } from "@/components/integration-settings.shared";

function pairingCodeDescription(
  pairingCode: string | null,
  paired: boolean
): string {
  if (pairingCode) {
    return "Open Linked Devices in WhatsApp and enter this code. It expires in 10 minutes.";
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
  showReconnect,
  reconnectPending,
  onReconnect,
  rowClassName,
}: {
  paired: boolean;
  pairingCode: string | null;
  copied: boolean;
  savePending: boolean;
  regeneratePending: boolean;
  onCopyPairingCode: () => void;
  onRegeneratePairingCode: () => void;
  showReconnect: boolean;
  reconnectPending: boolean;
  onReconnect: () => void;
  rowClassName?: string;
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
            className="list-decimal space-y-1 px-4 py-3 pl-8 text-muted-foreground text-xs"
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

type WhatsAppLinkView =
  | "error"
  | "idle"
  | "linking"
  | "preparing"
  | "qr"
  | "setup"
  | "start";

const LINK_BADGES: Record<
  WhatsAppLinkView,
  { label: string; tone: "danger" | "neutral" | "waiting" }
> = {
  error: { label: "Not linked", tone: "danger" },
  idle: { label: "Not linked", tone: "neutral" },
  linking: { label: "Linking", tone: "waiting" },
  preparing: { label: "Getting QR code", tone: "neutral" },
  qr: { label: "Waiting for scan", tone: "waiting" },
  setup: { label: "Not set up", tone: "neutral" },
  start: { label: "Offline", tone: "neutral" },
};

function resolveWhatsAppLinkView({
  awaitingQr,
  configured,
  linkError,
  linkingAfterScan,
  running,
  showQr,
}: {
  awaitingQr: boolean;
  configured: boolean;
  linkError: string | null;
  linkingAfterScan: boolean;
  running: boolean;
  showQr: boolean;
}): WhatsAppLinkView {
  if (!configured) {
    return "setup";
  }

  if (!running) {
    return "start";
  }

  if (linkError) {
    return "error";
  }

  if (showQr) {
    return "qr";
  }

  if (linkingAfterScan) {
    return "linking";
  }

  if (awaitingQr) {
    return "preparing";
  }

  return "idle";
}

interface WhatsAppLinkOwner {
  agentName: string;
  orgName: string;
}

function WhatsAppLinkBody({
  linkError,
  linkOwner,
  onReconnect,
  qrCode,
  reconnectPending,
  savePending,
  startConnection,
  view,
}: {
  linkError: string | null;
  linkOwner: WhatsAppLinkOwner | null;
  onReconnect: () => void;
  qrCode: string | null;
  reconnectPending: boolean;
  savePending: boolean;
  startConnection: ReactNode;
  view: WhatsAppLinkView;
}) {
  const reconnectIcon = reconnectPending ? (
    <Spinner className="size-3" />
  ) : (
    <QrCodeScanIcon aria-hidden className="size-4" />
  );

  if (view === "start") {
    return startConnection;
  }

  if (view === "setup") {
    return (
      <p className="px-4 py-5 text-muted-foreground text-sm">
        Connect WhatsApp to let people message this agent.
      </p>
    );
  }

  if (view === "error") {
    return (
      <div className="flex gap-4 px-4 py-5" role="alert">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircleIcon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 space-y-2">
          <h2 className="font-semibold text-base">
            Could not link this number
          </h2>
          {linkOwner ? (
            <p className="text-pretty text-muted-foreground text-sm">
              <strong className="text-foreground">{linkOwner.agentName}</strong>{" "}
              in{" "}
              <strong className="text-foreground">{linkOwner.orgName}</strong>{" "}
              already uses this number. Scan with a different number, or unlink
              it from {linkOwner.agentName} first.
            </p>
          ) : (
            <p className="text-pretty text-muted-foreground text-sm">
              {linkError} Scan again with a different WhatsApp number.
            </p>
          )}
          <Button
            className="mt-2"
            disabled={reconnectPending || savePending}
            onClick={onReconnect}
            type="button"
          >
            {reconnectIcon}
            Scan with another number
          </Button>
        </div>
      </div>
    );
  }

  if (view === "qr") {
    return (
      <div className="flex flex-wrap items-center gap-6 px-4 py-5">
        <div className="rounded-xl border border-border bg-white p-3">
          <QRCodeSVG size={180} title="WhatsApp QR code" value={qrCode!} />
        </div>
        <div className="min-w-56 flex-1 basis-56 space-y-3">
          <h2 className="font-semibold text-base">Scan with your phone</h2>
          <ol
            aria-label="Steps to connect WhatsApp"
            className="list-decimal space-y-1.5 pl-5 text-muted-foreground text-sm"
          >
            <li>
              Open <strong className="text-foreground">WhatsApp</strong>
            </li>
            <li>
              Go to{" "}
              <strong className="text-foreground">
                Settings › Linked devices
              </strong>
            </li>
            <li>
              Tap <strong className="text-foreground">Link a device</strong> and
              scan this code
            </li>
          </ol>
        </div>
      </div>
    );
  }

  if (view === "idle") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5">
        <p className="text-muted-foreground text-sm">No QR code yet.</p>
        <Button
          disabled={reconnectPending || savePending}
          onClick={onReconnect}
          type="button"
          variant="outline"
        >
          {reconnectIcon}
          Get a QR code
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-5 text-muted-foreground text-sm">
      <Spinner className="size-4" />
      {view === "linking" ? "Linking your account…" : "Getting a QR code…"}
    </div>
  );
}

export function WhatsAppLinkStatusCard({
  awaitingQr,
  configured,
  footer,
  linkError,
  linkOwner,
  linkingAfterScan,
  onReconnect,
  qrCode,
  reconnectPending,
  running,
  savePending,
  showQr,
  startConnection,
}: {
  awaitingQr: boolean;
  configured: boolean;
  footer: ReactNode;
  linkError: string | null;
  linkOwner: WhatsAppLinkOwner | null;
  linkingAfterScan: boolean;
  onReconnect: () => void;
  qrCode: string | null;
  reconnectPending: boolean;
  running: boolean;
  savePending: boolean;
  showQr: boolean;
  startConnection: ReactNode;
}) {
  const view = resolveWhatsAppLinkView({
    awaitingQr,
    configured,
    linkError,
    linkingAfterScan,
    running,
    showQr,
  });

  const badge = LINK_BADGES[view];

  return (
    <section
      aria-label="WhatsApp link status"
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-3">
        <span className="font-medium text-sm">Link status</span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 font-medium text-xs",
            badge.tone === "danger" && "bg-destructive/10 text-destructive",
            badge.tone === "waiting" &&
              "bg-amber-500/10 text-amber-800 dark:text-amber-200",
            badge.tone === "neutral" && "bg-muted text-muted-foreground"
          )}
        >
          {badge.label}
        </span>
      </div>
      <WhatsAppLinkBody
        linkError={linkError}
        linkOwner={linkOwner}
        onReconnect={onReconnect}
        qrCode={qrCode}
        reconnectPending={reconnectPending}
        savePending={savePending}
        startConnection={startConnection}
        view={view}
      />
      {footer}
    </section>
  );
}
