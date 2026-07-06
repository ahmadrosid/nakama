import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  getKnowledgeBaseExtractedPath,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseStoredDocumentPath,
} from "./paths";
import {
  deleteKnowledgeBaseDocument,
  listKnowledgeBaseDocuments,
  uploadKnowledgeBaseDocument,
} from "./store";

const ORG_ID = "org_test";

describe("knowledge base store", () => {
  let tempConfigDir = "";
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  async function setupProfile(profileId: string): Promise<void> {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-kb-store-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(path.join(tempConfigDir, "orgs", ORG_ID, "profiles", profileId), {
        recursive: true,
      }),
    );
  }

  test("uploads, lists, and deletes text documents", async () => {
    const profileId = "profile_kb_test";
    await setupProfile(profileId);

    const content = Buffer.from("needle in haystack", "utf8").toString("base64");
    const uploaded = await uploadKnowledgeBaseDocument(ORG_ID, profileId, {
      filename: "notes.txt",
      mediaType: "text/plain",
      data: content,
    });

    expect(uploaded.status).toBe("ready");
    expect(uploaded.filename).toBe("notes.txt");

    const listed = await listKnowledgeBaseDocuments(ORG_ID, profileId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(uploaded.id);

    const extracted = await readFile(
      getKnowledgeBaseExtractedPath(ORG_ID, profileId, uploaded.id),
      "utf8",
    );
    expect(extracted).toContain("# source: notes.txt");
    expect(extracted).toContain("needle in haystack");

    const manifest = await readFile(getKnowledgeBaseManifestPath(ORG_ID, profileId), "utf8");
    expect(manifest).toContain(uploaded.id);

    const storedPath = getKnowledgeBaseStoredDocumentPath(
      ORG_ID,
      profileId,
      uploaded.id,
      uploaded.filename,
    );
    expect(storedPath).toContain(uploaded.id);
    expect(await readFile(storedPath, "utf8")).toContain("needle in haystack");

    const deleted = await deleteKnowledgeBaseDocument(ORG_ID, profileId, uploaded.id);
    expect(deleted).toBe(true);
    expect(await listKnowledgeBaseDocuments(ORG_ID, profileId)).toHaveLength(0);
  });

  test("rejects unsupported document types", async () => {
    const profileId = "profile_kb_reject";
    await setupProfile(profileId);

    await expect(
      uploadKnowledgeBaseDocument(ORG_ID, profileId, {
        filename: "archive.zip",
        mediaType: "application/zip",
        data: Buffer.from("zip").toString("base64"),
      }),
    ).rejects.toThrow(/Unsupported knowledge base document type/);
  });

  test("migrates legacy data/knowledge-base on first use", async () => {
    const profileId = "profile_kb_legacy";
    await setupProfile(profileId);

    const legacyDir = path.join(
      tempConfigDir,
      "orgs",
      ORG_ID,
      "profiles",
      profileId,
      "data",
      "knowledge-base",
    );
    await mkdir(path.join(legacyDir, "extracted"), { recursive: true });
    await mkdir(path.join(legacyDir, "uploads", "kb_legacy"), { recursive: true });
    await writeFile(
      path.join(legacyDir, "manifest.json"),
      JSON.stringify(
        {
          documents: [
            {
              id: "kb_legacy",
              filename: "legacy.txt",
              mediaType: "text/plain",
              sizeBytes: 11,
              uploadedAt: "2026-06-13T00:00:00.000Z",
              status: "ready",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(legacyDir, "extracted", "kb_legacy.txt"),
      "# source: legacy.txt\n\nlegacy body\n",
      "utf8",
    );
    await writeFile(
      path.join(legacyDir, "uploads", "kb_legacy", "legacy.txt"),
      "legacy body\n",
      "utf8",
    );

    await listKnowledgeBaseDocuments(ORG_ID, profileId);

    expect(
      await readFile(
        path.join(
          tempConfigDir,
          "orgs",
          ORG_ID,
          "profiles",
          profileId,
          "knowledge-base",
          "manifest.json",
        ),
        "utf8",
      ),
    ).toContain("\"documents\"");
    expect(
      await readFile(
        path.join(
          tempConfigDir,
          "orgs",
          ORG_ID,
          "profiles",
          profileId,
          "knowledge-base",
          "kb_legacy.extracted.txt",
        ),
        "utf8",
      ),
    ).toContain("legacy body");
    expect(
      await readFile(
        path.join(
          tempConfigDir,
          "orgs",
          ORG_ID,
          "profiles",
          profileId,
          "knowledge-base",
          "kb_legacy--legacy.txt",
        ),
        "utf8",
      ),
    ).toContain("legacy body");
    await expect(readFile(path.join(legacyDir, "manifest.json"), "utf8")).rejects.toThrow();
  });
});
