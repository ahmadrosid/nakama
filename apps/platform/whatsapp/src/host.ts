import { AsyncLocalStorage } from "node:async_hooks";
import { createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";
import type { ChannelOwner } from "@nakama/core/channel-config-shared";

type ConsoleWriter = (...args: unknown[]) => void;

interface ConsoleTarget {
  debug: ConsoleWriter;
  error: ConsoleWriter;
  info: ConsoleWriter;
  log: ConsoleWriter;
  warn: ConsoleWriter;
}

interface ChannelLogs {
  stderr: WriteStream;
  stdout: WriteStream;
}

export interface WhatsAppChannelHandle {
  stop: () => Promise<void>;
}

const channelLogs = new AsyncLocalStorage<ChannelLogs>();

const STDERR_METHODS = new Set(["error", "warn"]);

/**
 * One process serves many numbers, so console output from a channel's async
 * work goes to that channel's own stdout.log / stderr.log, as with pm2 before.
 */
export function installChannelLogRouting(
  target: ConsoleTarget = console
): void {
  for (const method of ["debug", "error", "info", "log", "warn"] as const) {
    const original = target[method].bind(target);

    target[method] = (...args) => {
      const logs = channelLogs.getStore();

      if (!logs) {
        original(...args);

        return;
      }

      const stream = STDERR_METHODS.has(method) ? logs.stderr : logs.stdout;
      stream.write(`${format(...args)}\n`);
    };
  }
}

function openChannelLogs(directory: string): ChannelLogs {
  return {
    stderr: createWriteStream(join(directory, "stderr.log"), { flags: "a" }),
    stdout: createWriteStream(join(directory, "stdout.log"), { flags: "a" }),
  };
}

function closeChannelLogs(logs: ChannelLogs): Promise<void> {
  const close = (stream: WriteStream) =>
    new Promise<void>((resolve) => {
      stream.end(resolve);
    });

  return Promise.all([close(logs.stdout), close(logs.stderr)]).then(() => {});
}

function ownerKey(owner: ChannelOwner): string {
  return JSON.stringify([owner.orgId, owner.profileId]);
}

/**
 * Keeps the running channels equal to the wanted list. A channel that fails
 * to start is retried later; the other numbers keep running.
 */
export function createWhatsAppHost(options: {
  getLogDir: (owner: ChannelOwner) => string;
  readOwners: () => Promise<ChannelOwner[]>;
  retryMs?: number;
  start: (owner: ChannelOwner) => Promise<WhatsAppChannelHandle>;
}) {
  const retryMs = options.retryMs ?? 30_000;

  const running = new Map<
    string,
    { handle: WhatsAppChannelHandle; logs: ChannelLogs }
  >();

  const failedAt = new Map<string, number>();
  let queue: Promise<void> = Promise.resolve();

  const stopChannel = async (key: string) => {
    const channel = running.get(key);

    if (!channel) {
      return;
    }

    running.delete(key);

    try {
      await channelLogs.run(channel.logs, () => channel.handle.stop());
    } catch (error) {
      console.error(`WhatsApp channel ${key} did not stop cleanly.`, error);
    } finally {
      await closeChannelLogs(channel.logs);
    }
  };

  const startChannel = async (key: string, owner: ChannelOwner) => {
    const logs = openChannelLogs(options.getLogDir(owner));

    try {
      const handle = await channelLogs.run(logs, () => options.start(owner));
      running.set(key, { handle, logs });
      failedAt.delete(key);
    } catch (error) {
      failedAt.set(key, Date.now());
      const message = error instanceof Error ? error.message : String(error);
      logs.stderr.write(`${message}\n`);
      await closeChannelLogs(logs);
      console.error(`WhatsApp channel ${key} failed to start: ${message}`);
    }
  };

  const reconcile = async () => {
    const wanted = new Map(
      (await options.readOwners()).map((owner) => [ownerKey(owner), owner])
    );

    for (const key of [...running.keys()]) {
      if (!wanted.has(key)) {
        await stopChannel(key);
      }
    }

    for (const key of [...failedAt.keys()]) {
      if (!wanted.has(key)) {
        failedAt.delete(key);
      }
    }

    for (const [key, owner] of wanted) {
      const failed = failedAt.get(key);

      if (
        running.has(key) ||
        (failed !== undefined && Date.now() - failed < retryMs)
      ) {
        continue;
      }

      await startChannel(key, owner);
    }
  };

  const enqueue = (work: () => Promise<void>) => {
    const next = queue.catch(() => {}).then(work);
    queue = next;

    return next;
  };

  return {
    reconcile: () => enqueue(reconcile),
    runningCount: () => running.size,
    stopAll: () =>
      enqueue(async () => {
        for (const key of [...running.keys()]) {
          await stopChannel(key);
        }
      }),
  };
}
