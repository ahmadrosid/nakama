import { afterEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_HTML_ARTIFACT_BYTES } from "./artifact-mime";
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
  `artifact-shares-${crypto.randomUUID()}`
);

describe("artifact shares", () => {
  afterEach(async () => {
    delete process.env.NAKAMA_CONFIG_DIR;
    await rm(TEST_CONFIG_DIR, { force: true, recursive: true });
  });

  test("generateArtifactShareToken returns high-entropy share tokens without underscores", () => {
    const token = generateArtifactShareToken();
    expect(token.startsWith("nkshare")).toBe(true);
    expect(token).not.toContain("_");
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
      bytes,
      filename: "report.md",
      orgId,
      shareId,
    });

    expect(storagePath.startsWith(getArtifactSharesDir(orgId))).toBe(true);
    expect(await readArtifactShareSnapshot(orgId, storagePath)).toEqual(bytes);
    await deleteArtifactShareSnapshot(orgId, storagePath);
  });

  test("rejects oversized HTML snapshots without replacing the saved copy", async () => {
    process.env.NAKAMA_CONFIG_DIR = TEST_CONFIG_DIR;

    const input = {
      bytes: Buffer.alloc(MAX_HTML_ARTIFACT_BYTES, "x"),
      filename: "page.bin",
      mimeType: "text/html",
      orgId: "org_test",
      shareId: "share_html",
    };

    const storagePath = await writeArtifactShareSnapshot(input);
    expect(
      (
        await readArtifactShareSnapshot(
          input.orgId,
          storagePath,
          input.mimeType
        )
      ).byteLength
    ).toBe(MAX_HTML_ARTIFACT_BYTES);
    const oversized = Buffer.alloc(MAX_HTML_ARTIFACT_BYTES + 1, "x");
    await expect(
      writeArtifactShareSnapshot({ ...input, bytes: oversized })
    ).rejects.toMatchObject({ status: 413 });
    expect((await readFile(storagePath)).byteLength).toBe(
      MAX_HTML_ARTIFACT_BYTES
    );
    await writeFile(storagePath, oversized);
    await expect(
      readArtifactShareSnapshot(input.orgId, storagePath, input.mimeType)
    ).rejects.toMatchObject({ status: 413 });
  });
});
