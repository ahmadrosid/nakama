import { AsyncLocalStorage } from "node:async_hooks";
import { createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { format } from "node:util";
import type { ChannelOwner } from "@nakama/core/channel-config-shared";

interface ChannelLogs {
  stderr: WriteStream;
  stdout: WriteStream;
}

export interface WhatsAppChannelHandle {
  stop: () => Promise<void>;
}

const channelLogs = new AsyncLocalStorage<ChannelLogs>();

/**
 * One process serves many numbers, so console output from a channel's async
 * work goes to that channel's own stdout.log / stderr.log, as with pm2 before.
 */
export function installChannelLogRouting(
  target: Pick<Console, "debug" | "error" | "info" | "log" | "warn"> = console
): void {
  for (const method of ["debug", "error", "info", "log", "warn"] as const) {
    const original = target[method].bind(target);

    target[method] = (...args) => {
      const logs = channelLogs.getStore();

      if (!logs) {
        original(...args);

        return;
      }

      const toStderr = method === "error" || method === "warn";
      const stream = toStderr ? logs.stderr : logs.stdout;

      // Async work can outlive its channel; a closed log must not throw.
      if (stream.writableEnded || stream.destroyed) {
        original(...args);

        return;
      }

      stream.write(`${format(...args)}\n`);
    };
  }
}

async function closeChannelLogs(logs: ChannelLogs): Promise<void> {
  logs.stdout.end();
  logs.stderr.end();
  await Promise.all([finished(logs.stdout), finished(logs.stderr)]);
}

/**
 * Keeps the running channels equal to the wanted list. A channel that fails
 * to start is retried later; the other numbers keep running.
 */
export function createWhatsAppHost(options: {
  getLogDir: (owner: ChannelOwner) => string;
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
    running.delete(key);
    failedAt.delete(key);

    if (!channel) {
      return;
    }

    try {
      await channelLogs.run(channel.logs, () => channel.handle.stop());
    } catch (error) {
      console.error(`WhatsApp channel ${key} did not stop cleanly.`, error);
    } finally {
      await closeChannelLogs(channel.logs);
    }
  };

  const startChannel = async (key: string, owner: ChannelOwner) => {
    const directory = options.getLogDir(owner);

    const logs = {
      stderr: createWriteStream(join(directory, "stderr.log"), { flags: "a" }),
      stdout: createWriteStream(join(directory, "stdout.log"), { flags: "a" }),
    };

    // An unhandled stream error would crash every channel in this process.
    for (const stream of [logs.stderr, logs.stdout]) {
      stream.on("error", (error) => {
        process.stderr.write(
          `WhatsApp channel ${key} log write failed: ${error.message}\n`
        );
      });
    }

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

  const sync = async (owners: ChannelOwner[]) => {
    const wanted = new Map(
      owners.map((owner) => [
        JSON.stringify([owner.orgId, owner.profileId]),
        owner,
      ])
    );

    for (const key of new Set([...running.keys(), ...failedAt.keys()])) {
      if (!wanted.has(key)) {
        await stopChannel(key);
      }
    }

    for (const [key, owner] of wanted) {
      const failed = failedAt.get(key) ?? Number.NEGATIVE_INFINITY;

      if (!running.has(key) && Date.now() - failed >= retryMs) {
        await startChannel(key, owner);
      }
    }
  };

  /** Runs one sync at a time, so a poll never overlaps a stop. */
  return (owners: ChannelOwner[]) => {
    queue = queue.catch(() => {}).then(() => sync(owners));

    return queue;
  };
}
