import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWhatsAppHost, installChannelLogRouting } from "./host";

const first = { orgId: "org_a", profileId: "agent_a" };

const second = { orgId: "org_a", profileId: "agent_b" };

let root = "";

// Channels still running when a test ends open their log files late.
const hosts: ReturnType<typeof createWhatsAppHost>[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "nakama-whatsapp-host-"));
  await mkdir(join(root, first.profileId));
  await mkdir(join(root, second.profileId));
});

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((sync) => sync([])));
  await rm(root, { force: true, recursive: true });
});

function createTestHost(options: { failing?: Set<string>; retryMs?: number }) {
  const events: string[] = [];

  const sync = createWhatsAppHost({
    getLogDir: (owner) => join(root, owner.profileId),
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

  hosts.push(sync);

  return { events, sync };
}

test("starts and stops channels to match the wanted list", async () => {
  const { events, sync } = createTestHost({});

  await sync([first, second]);
  await sync([first, second]);
  expect(events).toEqual(["start agent_a", "start agent_b"]);

  await sync([second]);
  expect(events.at(-1)).toBe("stop agent_a");

  await sync([]);
  expect(events).toEqual([
    "start agent_a",
    "start agent_b",
    "stop agent_a",
    "stop agent_b",
  ]);
});

test("a channel that fails to start does not stop the others", async () => {
  const failing = new Set([first.profileId]);
  const { events, sync } = createTestHost({ failing, retryMs: 60_000 });

  await sync([first, second]);
  expect(events).toEqual(["start agent_b"]);

  expect(
    (await readFile(join(root, first.profileId, "stderr.log"), "utf8")).length
  ).toBeGreaterThan(0);

  failing.clear();
  await sync([first, second]);
  expect(events).toEqual(["start agent_b"]);
});

test("retries a failed channel after the retry delay", async () => {
  const failing = new Set([first.profileId]);
  const { events, sync } = createTestHost({ failing, retryMs: 0 });

  await sync([first]);
  expect(events).toEqual([]);

  failing.clear();
  await sync([first]);
  expect(events).toEqual(["start agent_a"]);
});

test("console output from a channel goes to that channel's log files", async () => {
  const lines: string[] = [];

  const write = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };

  const target = {
    debug: write,
    error: write,
    info: write,
    log: write,
    warn: write,
  };

  installChannelLogRouting(target);

  const sync = createWhatsAppHost({
    getLogDir: (owner) => join(root, owner.profileId),
    start: async (owner) => {
      target.log(`hello from ${owner.profileId}`);
      setTimeout(() => target.error(`later from ${owner.profileId}`), 0);
      await Bun.sleep(5);

      return { stop: async () => {} };
    },
  });

  hosts.push(sync);

  await sync([first, second]);
  target.log("host line");
  await sync([]);

  expect(lines).toEqual(["host line"]);

  expect(
    await readFile(join(root, first.profileId, "stdout.log"), "utf8")
  ).toBe("hello from agent_a\n");

  expect(
    await readFile(join(root, second.profileId, "stderr.log"), "utf8")
  ).toBe("later from agent_b\n");
});
