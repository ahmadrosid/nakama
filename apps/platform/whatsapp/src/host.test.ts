import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelOwner } from "@nakama/core/channel-config-shared";
import { createWhatsAppHost, installChannelLogRouting } from "./host";

const first = { orgId: "org_a", profileId: "agent_a" };

const second = { orgId: "org_a", profileId: "agent_b" };

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nakama-whatsapp-host-"));
  await mkdir(join(root, first.profileId));
  await mkdir(join(root, second.profileId));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

function createTestHost(options: {
  owners: ChannelOwner[];
  failing?: Set<string>;
  retryMs?: number;
}) {
  const events: string[] = [];

  const host = createWhatsAppHost({
    getLogDir: (owner) => join(root, owner.profileId),
    readOwners: async () => options.owners,
    retryMs: options.retryMs,
    start: async (owner) => {
      if (options.failing?.has(owner.profileId)) {
        throw new Error(`cannot start ${owner.profileId}`);
      }

      events.push(`start ${owner.profileId}`);

      return {
        stop: async () => {
          events.push(`stop ${owner.profileId}`);
        },
      };
    },
  });

  return { events, host };
}

test("starts and stops channels to match the wanted list", async () => {
  const owners = [first, second];
  const { events, host } = createTestHost({ owners });

  await host.reconcile();
  await host.reconcile();
  expect(events).toEqual(["start agent_a", "start agent_b"]);
  expect(host.runningCount()).toBe(2);

  owners.splice(0, 1);
  await host.reconcile();
  expect(events.at(-1)).toBe("stop agent_a");
  expect(host.runningCount()).toBe(1);

  await host.stopAll();
  expect(events.at(-1)).toBe("stop agent_b");
  expect(host.runningCount()).toBe(0);
});

test("a channel that fails to start does not stop the others", async () => {
  const failing = new Set([first.profileId]);

  const { events, host } = createTestHost({
    failing,
    owners: [first, second],
    retryMs: 60_000,
  });

  await host.reconcile();
  expect(events).toEqual(["start agent_b"]);
  expect(host.runningCount()).toBe(1);
  expect(
    (await readFile(join(root, first.profileId, "stderr.log"), "utf8")).length
  ).toBeGreaterThan(0);

  failing.clear();
  await host.reconcile();
  expect(host.runningCount()).toBe(1);
});

test("retries a failed channel after the retry delay", async () => {
  const failing = new Set([first.profileId]);

  const { events, host } = createTestHost({
    failing,
    owners: [first],
    retryMs: 0,
  });

  await host.reconcile();
  expect(host.runningCount()).toBe(0);

  failing.clear();
  await host.reconcile();
  expect(events).toEqual(["start agent_a"]);
  expect(host.runningCount()).toBe(1);
});

test("console output from a channel goes to that channel's log files", async () => {
  const lines: string[] = [];

  const target = {
    debug: (...args: unknown[]) => lines.push(args.join(" ")),
    error: (...args: unknown[]) => lines.push(args.join(" ")),
    info: (...args: unknown[]) => lines.push(args.join(" ")),
    log: (...args: unknown[]) => lines.push(args.join(" ")),
    warn: (...args: unknown[]) => lines.push(args.join(" ")),
  };

  installChannelLogRouting(target);

  const host = createWhatsAppHost({
    getLogDir: (owner) => join(root, owner.profileId),
    readOwners: async () => [first, second],
    start: async (owner) => {
      target.log(`hello from ${owner.profileId}`);
      setTimeout(() => target.error(`later from ${owner.profileId}`), 0);
      await Bun.sleep(5);

      return { stop: async () => {} };
    },
  });

  await host.reconcile();
  target.log("host line");
  await host.stopAll();

  expect(lines).toEqual(["host line"]);
  expect(
    await readFile(join(root, first.profileId, "stdout.log"), "utf8")
  ).toBe("hello from agent_a\n");
  expect(
    await readFile(join(root, second.profileId, "stderr.log"), "utf8")
  ).toBe("later from agent_b\n");
});
