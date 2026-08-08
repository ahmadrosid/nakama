import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseWorkerDesiredState,
  readWorkerDesiredState,
  setWorkerDesiredRunning,
} from "./worker-desired-state";

const configDirs: string[] = [];

afterEach(async () => {
  const previous = configDirs.splice(0);

  for (const dir of previous) {
    await rm(dir, { force: true, recursive: true });
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
      automation: true,
      discord: false,
      telegram: true,
      whatsapp: false,
    });
  });

  test("returns defaults for invalid json", () => {
    expect(parseWorkerDesiredState("not-json")).toEqual({
      automation: true,
      discord: false,
      telegram: false,
      whatsapp: false,
    });
  });

  test("backward compatible: missing automation key defaults to true", () => {
    expect(
      parseWorkerDesiredState('{"telegram":false,"whatsapp":false}')
    ).toEqual({
      automation: true,
      discord: false,
      telegram: false,
      whatsapp: false,
    });
  });

  test("explicit automation false is honored", () => {
    expect(
      parseWorkerDesiredState(
        '{"telegram":false,"whatsapp":false,"automation":false}'
      )
    ).toEqual({
      automation: false,
      discord: false,
      telegram: false,
      whatsapp: false,
    });
  });
});

describe("worker desired state persistence", () => {
  test("reads defaults when file is missing", async () => {
    await withConfigDir(async () => {
      expect(await readWorkerDesiredState()).toEqual({
        automation: true,
        discord: false,
        telegram: false,
        whatsapp: false,
      });
    });
  });

  test("persists start and stop intent", async () => {
    await withConfigDir(async () => {
      await setWorkerDesiredRunning("telegram", true);
      expect(await readWorkerDesiredState()).toEqual({
        automation: true,
        discord: false,
        telegram: true,
        whatsapp: false,
      });

      await setWorkerDesiredRunning("whatsapp", true);
      expect(await readWorkerDesiredState()).toEqual({
        automation: true,
        discord: false,
        telegram: true,
        whatsapp: true,
      });

      await setWorkerDesiredRunning("automation", false);
      expect(await readWorkerDesiredState()).toEqual({
        automation: false,
        discord: false,
        telegram: true,
        whatsapp: true,
      });

      await setWorkerDesiredRunning("telegram", false);
      expect(await readWorkerDesiredState()).toEqual({
        automation: false,
        discord: false,
        telegram: false,
        whatsapp: true,
      });
    });
  });

  test("loads existing file from disk", async () => {
    await withConfigDir(async () => {
      const runtimeDir = join(process.env.NAKAMA_CONFIG_DIR!, "runtime");
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(
        join(runtimeDir, "worker-desired-state.json"),
        '{"telegram":true,"whatsapp":false}\n'
      );

      expect(await readWorkerDesiredState()).toEqual({
        automation: true,
        discord: false,
        telegram: true,
        whatsapp: false,
      });
    });
  });
});
