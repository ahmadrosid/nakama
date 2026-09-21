import type { TelegramPairingStartResponse } from "@nakama/core";
import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { QrCodeScanIcon } from "hugeicons-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import {
  useApplyTelegramPairing,
  useCancelTelegramPairing,
  useStartTelegramPairing,
  useTelegramPairingStatus,
} from "@/hooks/use-app-queries";
import { useRestartWorker, useStartWorker } from "@/hooks/use-worker-actions";
import { formatError } from "@/lib/client";

export function TelegramQrSetup({
  profileId,
  running,
}: {
  profileId: string;
  running: boolean;
}) {
  const [pairing, setPairing] = useState<TelegramPairingStartResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const start = useStartTelegramPairing();
  const status = useTelegramPairingStatus(pairing?.pairingId ?? null);
  const cancel = useCancelTelegramPairing();
  const apply = useApplyTelegramPairing();
  const currentStatus = status.data?.status;

  const startWorker = useStartWorker();
  const restartWorker = useRestartWorker();
  function startPairing() {
    setError(null);
    start.mutate(
      { profileId },
      {
        onError: (reason) => setError(formatError(reason)),
        onSuccess: (result) => {
          setPairing(result);
        },
      }
    );
  }

  function cancelPairing() {
    if (!pairing?.pairingId) {
      return;
    }
    cancel.mutate(pairing?.pairingId, {
      onError: (reason) => setError(formatError(reason)),
      onSuccess: () => {
        setPairing(null);
      },
    });
  }

  function applyPairing() {
    if (!pairing?.pairingId) {
      return;
    }
    apply.mutate(
      { pairingId: pairing?.pairingId ?? null, profileId },
      {
        onError: (reason) => setError(formatError(reason)),
        onSuccess: () => {
          const workerMutation = running ? restartWorker : startWorker;
          workerMutation.mutate("telegram", {
            onError: (reason) => setError(formatError(reason)),
            onSuccess: () => {
              setPairing(null);
            },
          });
        },
      }
    );
  }

  if (!pairing) {
    return (
      <StartTelegramPairing
        error={error}
        onStart={startPairing}
        pending={start.isPending}
      />
    );
  }

  const waiting = currentStatus === "waiting" || status.isLoading;
  const ready = currentStatus === "ready";
  const expired = currentStatus === "expired" || currentStatus === "cancelled";

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-sm">Create with QR</p>
        <Button
          disabled={cancel.isPending || apply.isPending}
          onClick={cancelPairing}
          size="sm"
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
      </div>
      {waiting ? (
        <>
          <div className="flex flex-col items-center gap-2 p-4">
            <span className="rounded-full bg-zinc-800 px-3 py-1 font-semibold text-[10px] text-white uppercase tracking-wider">
              Scan me
            </span>
            <div className="rounded-2xl border-4 border-zinc-800 bg-white p-3 shadow-[0_4px_0_#27272a]">
              <QRCodeSVG
                bgColor="#ffffff"
                fgColor="#27272a"
                size={180}
                value={pairing.qrPayload}
              />
            </div>
          </div>
          <Button
            onClick={() =>
              window.open(pairing.deepLink, "_blank", "noopener,noreferrer")
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Open Telegram to Create Bot
          </Button>
          <p className="text-muted-foreground text-xs">
            If prompted, press Start, then create your bot. Keep the suggested
            username.
          </p>
        </>
      ) : null}
      {ready ? (
        <div className="space-y-2 text-sm">
          <p>
            Bot: <strong>@{status.data?.botUsername}</strong>
          </p>
          <p className="text-muted-foreground text-xs">
            Owner Telegram ID: {status.data?.ownerUserId}
          </p>
          <Button
            disabled={apply.isPending}
            onClick={applyPairing}
            size="sm"
            type="button"
          >
            {apply.isPending ? <Spinner className="size-3" /> : null}
            Connect bot
          </Button>
        </div>
      ) : null}
      {expired ? (
        <p className="text-destructive text-xs">
          This QR setup expired. Start again.
        </p>
      ) : null}
      {status.error ? (
        <p className="text-destructive text-xs">{formatError(status.error)}</p>
      ) : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <p className="text-muted-foreground text-xs">
        Expires {new Date(pairing.expiresAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

function StartTelegramPairing({
  error,
  onStart,
  pending,
}: {
  error: string | null;
  onStart: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-4 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-sm">Create with QR</p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
          Recommended
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        Scan a QR code to create your bot in Telegram. No token to copy.
      </p>
      <Button disabled={pending} onClick={onStart} size="sm" type="button">
        {pending ? (
          <Spinner className="size-3" />
        ) : (
          <QrCodeScanIcon className="size-3.5" />
        )}
        Create with QR
      </Button>
      {error ? <p className="mt-2 text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
