import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  parseWorkerDesiredState,
  readWorkerDesiredState,
  setWorkerDesiredRunning,
} from "./worker-desired-state";

const configDirs: string[] = [];

afterEach(async () => {
  const previous = configDirs.splice(0);

  for (const dir of previous) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function withConfigDir<T>(run: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "nakama-worker-desired-"));
  configDirs.push(dir);
  const previous = process.env.NAKAMA_CONFIG_DIR;
  process.env.NAKAMA_CONFIG_DIR = dir;

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previous;
    }
  }
}

describe("parseWorkerDesiredState", () => {
  test("defaults missing keys to false except automation", () => {
    expect(parseWorkerDesiredState('{"telegram": true}')).toEqual({
      telegram: true,
      whatsapp: false,
      discord: false,
      automation: true,
    });
  });

  test("returns defaults for invalid json", () => {
    expect(parseWorkerDesiredState("not-json")).toEqual({
      telegram: false,
      whatsapp: false,
      discord: false,
      automation: true,
    });
  });

  test("backward compatible: missing automation key defaults to true", () => {
    expect(parseWorkerDesiredState('{"telegram":false,"whatsapp":false}')).toEqual({
      telegram: false,
      whatsapp: false,
      discord: false,
      automation: true,
    });
  });

  test("explicit automation false is honored", () => {
    expect(parseWorkerDesiredState('{"telegram":false,"whatsapp":false,"automation":false}')).toEqual({
      telegram: false,
      whatsapp: false,
      discord: false,
      automation: false,
    });
  });
});

describe("worker desired state persistence", () => {
  test("reads defaults when file is missing", async () => {
    await withConfigDir(async () => {
      expect(await readWorkerDesiredState()).toEqual({
        telegram: false,
        whatsapp: false,
        discord: false,
        automation: true,
      });
    });
  });

  test("persists start and stop intent", async () => {
    await withConfigDir(async () => {
      await setWorkerDesiredRunning("telegram", true);
      expect(await readWorkerDesiredState()).toEqual({
        telegram: true,
        whatsapp: false,
        discord: false,
        automation: true,
      });

      await setWorkerDesiredRunning("whatsapp", true);
      expect(await readWorkerDesiredState()).toEqual({
        telegram: true,
        whatsapp: true,
        discord: false,
        automation: true,
      });

      await setWorkerDesiredRunning("automation", false);
      expect(await readWorkerDesiredState()).toEqual({
        telegram: true,
        whatsapp: true,
        discord: false,
        automation: false,
      });

      await setWorkerDesiredRunning("telegram", false);
      expect(await readWorkerDesiredState()).toEqual({
        telegram: false,
        whatsapp: true,
        discord: false,
        automation: false,
      });
    });
  });

  test("loads existing file from disk", async () => {
    await withConfigDir(async () => {
      const runtimeDir = join(process.env.NAKAMA_CONFIG_DIR!, "runtime");
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(
        join(runtimeDir, "worker-desired-state.json"),
        '{"telegram":true,"whatsapp":false}\n',
      );

      expect(await readWorkerDesiredState()).toEqual({
        telegram: true,
        whatsapp: false,
        discord: false,
        automation: true,
      });
    });
  });
});
