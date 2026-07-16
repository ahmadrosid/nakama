import { afterEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  buildArtifactSharePath,
  deleteArtifactShareSnapshot,
  generateArtifactShareToken,
  readArtifactShareSnapshot,
  writeArtifactShareSnapshot,
} from "./artifact-shares";
import { getArtifactSharesDir } from "./soul/resolve";

const TEST_CONFIG_DIR = path.join(
  process.cwd(),
  ".tmp-test-config",
  `artifact-shares-${crypto.randomUUID()}`,
);

describe("artifact shares", () => {
  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = undefined;
    await rm(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  test("generateArtifactShareToken returns high-entropy share tokens", () => {
    const token = generateArtifactShareToken();
    expect(token.startsWith("tc_share_")).toBe(true);
    expect(token.length).toBeGreaterThan(40);
  });

  test("buildArtifactSharePath returns SPA route", () => {
    expect(buildArtifactSharePath("abc123")).toBe("/s/abc123");
  });

  test("write and read snapshot round-trip", async () => {
    process.env.NAKAMA_CONFIG_DIR = TEST_CONFIG_DIR;
    await mkdir(TEST_CONFIG_DIR, { recursive: true });

    const orgId = "org_test";
    const shareId = "share_test";
    const bytes = Buffer.from("# Hello", "utf8");
    const storagePath = await writeArtifactShareSnapshot({
      orgId,
      shareId,
      filename: "report.md",
      bytes,
    });

    expect(storagePath.startsWith(getArtifactSharesDir(orgId))).toBe(true);
    expect(await readArtifactShareSnapshot(storagePath)).toEqual(bytes);
    await deleteArtifactShareSnapshot(storagePath);
  });
});
