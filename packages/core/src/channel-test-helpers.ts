import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import {
  type ChannelOrgSelectionChannel,
  ChannelOrgStore,
} from "./channel-org";
import type { UserOrgSummary } from "./contract";

export function createDefaultTestOrgs(): UserOrgSummary[] {
  const now = new Date().toISOString();

  return [
    {
      createdAt: now,
      id: "org_test",
      name: "Test Org",
      role: "admin",
      slug: "test-org",
      updatedAt: now,
    },
  ];
}

export function createMultiTestOrgs(): UserOrgSummary[] {
  const now = new Date().toISOString();

  return [
    {
      createdAt: now,
      id: "org_a",
      name: "Acme",
      role: "admin",
      slug: "acme",
      updatedAt: now,
    },
    {
      createdAt: now,
      id: "org_b",
      name: "Beta",
      role: "member",
      slug: "beta",
      updatedAt: now,
    },
  ];
}

export function createTestOrgStore(
  homeDir: string,
  channel: ChannelOrgSelectionChannel
): ChannelOrgStore {
  return new ChannelOrgStore(
    path.join(homeDir, ".nakama", channel, "org-selection.json")
  );
}

const tempHomeChains = new Map<string, Promise<void>>();

export async function withTempHome<T>(
  prefix: string,
  run: (homeDir: string) => Promise<T>
): Promise<T> {
  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const previous = tempHomeChains.get(prefix) ?? Promise.resolve();
  tempHomeChains.set(
    prefix,
    previous.then(() => gate)
  );

  await previous;

  const homeDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const configDir = path.join(homeDir, ".nakama");
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
  process.env.NAKAMA_CONFIG_DIR = configDir;

  try {
    return await run(homeDir);
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }

    await rm(homeDir, { force: true, recursive: true });
    release();
  }
}
