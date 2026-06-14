import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  getKnowledgeBaseExtractedPath,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseUploadDir,
} from "./paths";
import {
  deleteKnowledgeBaseDocument,
  listKnowledgeBaseDocuments,
  uploadKnowledgeBaseDocument,
} from "./store";

describe("knowledge base store", () => {
  let tempConfigDir = "";
  const previousConfigDir = process.env.TINYCLAW_CONFIG_DIR;

  afterEach(async () => {
    process.env.TINYCLAW_CONFIG_DIR = previousConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  async function setupProfile(profileId: string): Promise<void> {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-kb-store-"));
    process.env.TINYCLAW_CONFIG_DIR = tempConfigDir;
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(path.join(tempConfigDir, "profiles", profileId), { recursive: true }),
    );
  }

  test("uploads, lists, and deletes text documents", async () => {
    const profileId = "profile_kb_test";
    await setupProfile(profileId);

    const content = Buffer.from("needle in haystack", "utf8").toString("base64");
    const uploaded = await uploadKnowledgeBaseDocument(profileId, {
      filename: "notes.txt",
      mediaType: "text/plain",
      data: content,
    });

    expect(uploaded.status).toBe("ready");
    expect(uploaded.filename).toBe("notes.txt");

    const listed = await listKnowledgeBaseDocuments(profileId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(uploaded.id);

    const extracted = await readFile(
      getKnowledgeBaseExtractedPath(profileId, uploaded.id),
      "utf8",
    );
    expect(extracted).toContain("# source: notes.txt");
    expect(extracted).toContain("needle in haystack");

    const manifest = await readFile(getKnowledgeBaseManifestPath(profileId), "utf8");
    expect(manifest).toContain(uploaded.id);

    const uploadDir = getKnowledgeBaseUploadDir(profileId, uploaded.id);
    expect(uploadDir).toContain(uploaded.id);

    const deleted = await deleteKnowledgeBaseDocument(profileId, uploaded.id);
    expect(deleted).toBe(true);
    expect(await listKnowledgeBaseDocuments(profileId)).toHaveLength(0);
  });

  test("rejects unsupported document types", async () => {
    const profileId = "profile_kb_reject";
    await setupProfile(profileId);

    await expect(
      uploadKnowledgeBaseDocument(profileId, {
        filename: "archive.zip",
        mediaType: "application/zip",
        data: Buffer.from("zip").toString("base64"),
      }),
    ).rejects.toThrow(/Unsupported knowledge base document type/);
  });
});
