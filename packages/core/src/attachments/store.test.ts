import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteAttachmentBytes,
  getAttachmentFilePath,
  readAttachmentBytes,
  saveAttachmentBytes,
} from "./store";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
let tempConfigDir = "";

afterEach(() => {
  if (tempConfigDir) {
    rmSync(tempConfigDir, { recursive: true, force: true });
    tempConfigDir = "";
  }

  if (originalConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
  }
});

function useTempConfigDir(): void {
  tempConfigDir = mkdtempSync(join(tmpdir(), "nakama-attachments-"));
  process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
}

describe("attachment store", () => {
  test("saves and reads attachment bytes under profile workspace", async () => {
    useTempConfigDir();
    const bytes = Buffer.from("hello attachment");

    const path = await saveAttachmentBytes("org_1", "profile_1", "att_1", bytes);

    expect(path).toBe(getAttachmentFilePath("org_1", "profile_1", "att_1"));
    expect(await readAttachmentBytes("org_1", "profile_1", "att_1")).toEqual(bytes);
  });

  test("deleteAttachmentBytes removes stored file", async () => {
    useTempConfigDir();
    await saveAttachmentBytes("org_1", "profile_1", "att_2", Buffer.from("bye"));

    await deleteAttachmentBytes("org_1", "profile_1", "att_2");

    expect(await readAttachmentBytes("org_1", "profile_1", "att_2")).toBeNull();
  });
});
