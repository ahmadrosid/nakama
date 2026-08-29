import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getKnowledgeBaseExtractedPath,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseStoredDocumentPath,
} from "./paths";
import {
  deleteKnowledgeBaseDocument,
  KnowledgeBaseDuplicateError,
  listKnowledgeBaseDocuments,
  readKnowledgeBaseDocumentContent,
  uploadKnowledgeBaseDocument,
} from "./store";

const ORG_ID = "org_test";

describe("knowledge base store", () => {
  let tempConfigDir = "";
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

  afterEach(async () => {
    if (previousConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
    }

    if (tempConfigDir) {
      await rm(tempConfigDir, { force: true, recursive: true });
      tempConfigDir = "";
    }
  });

  async function setupProfile(profileId: string): Promise<void> {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-kb-store-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(path.join(tempConfigDir, "orgs", ORG_ID, "profiles", profileId), {
        recursive: true,
      })
    );
  }

  test("uploads, lists, and deletes text documents", async () => {
    const profileId = "profile_kb_test";
    await setupProfile(profileId);

    const content = Buffer.from("needle in haystack", "utf8").toString(
      "base64"
    );
    const uploaded = await uploadKnowledgeBaseDocument(ORG_ID, profileId, {
      data: content,
      filename: "notes.txt",
      mediaType: "text/plain",
    });

    expect(uploaded.outcome).toBe("created");
    expect(uploaded.document.status).toBe("ready");
    expect(uploaded.document.filename).toBe("notes.txt");
    expect(uploaded.document.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const listed = await listKnowledgeBaseDocuments(ORG_ID, profileId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(uploaded.document.id);

    const extracted = await readFile(
      getKnowledgeBaseExtractedPath(ORG_ID, profileId, uploaded.document.id),
      "utf8"
    );
    expect(extracted).toContain("# source: notes.txt");
    expect(extracted).toContain("needle in haystack");

    const manifest = await readFile(
      getKnowledgeBaseManifestPath(ORG_ID, profileId),
      "utf8"
    );
    expect(manifest).toContain(uploaded.document.id);

    const storedPath = getKnowledgeBaseStoredDocumentPath(
      ORG_ID,
      profileId,
      uploaded.document.id,
      uploaded.document.filename
    );
    expect(storedPath).toContain(uploaded.document.id);
    expect(await readFile(storedPath, "utf8")).toContain("needle in haystack");

    const deleted = await deleteKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      uploaded.document.id
    );
    expect(deleted).toBe(true);
    expect(await listKnowledgeBaseDocuments(ORG_ID, profileId)).toHaveLength(0);
  });

  test("rejects duplicate uploads by default and supports skip/replace", async () => {
    const profileId = "profile_kb_dedupe";
    await setupProfile(profileId);

    const attachment = {
      data: Buffer.from("same bytes", "utf8").toString("base64"),
      filename: "notes.txt",
      mediaType: "text/plain",
    };

    const first = await uploadKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      attachment
    );
    expect(first.outcome).toBe("created");

    await expect(
      uploadKnowledgeBaseDocument(ORG_ID, profileId, attachment)
    ).rejects.toBeInstanceOf(KnowledgeBaseDuplicateError);

    const skipped = await uploadKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      attachment,
      { onDuplicate: "skip" }
    );
    expect(skipped.outcome).toBe("skipped");
    expect(skipped.document.id).toBe(first.document.id);
    expect(await listKnowledgeBaseDocuments(ORG_ID, profileId)).toHaveLength(1);

    const renamedSameBytes = {
      data: attachment.data,
      filename: "copy.txt",
      mediaType: "text/plain",
    };
    await expect(
      uploadKnowledgeBaseDocument(ORG_ID, profileId, renamedSameBytes)
    ).rejects.toMatchObject({ match: "content_hash" });

    const replaced = await uploadKnowledgeBaseDocument(
      ORG_ID,
      profileId,
      attachment,
      { onDuplicate: "replace" }
    );
    expect(replaced.outcome).toBe("replaced");
    expect(replaced.document.id).not.toBe(first.document.id);

    const listed = await listKnowledgeBaseDocuments(ORG_ID, profileId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(replaced.document.id);
  });

  test("detects duplicates by name and size when content hash is missing", async () => {
    const profileId = "profile_kb_name_size";
    await setupProfile(profileId);

    const first = await uploadKnowledgeBaseDocument(ORG_ID, profileId, {
      data: Buffer.from("legacy body", "utf8").toString("base64"),
      filename: "legacy.txt",
      mediaType: "text/plain",
    });

    const manifestPath = getKnowledgeBaseManifestPath(ORG_ID, profileId);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      documents: Array<Record<string, unknown>>;
    };
    delete manifest.documents[0]?.contentHash;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(
      uploadKnowledgeBaseDocument(ORG_ID, profileId, {
        data: Buffer.from("xxxxxxxxxxx", "utf8").toString("base64"),
        filename: "legacy.txt",
        mediaType: "text/plain",
      })
    ).rejects.toMatchObject({ match: "name_size" });

    expect(first.document.filename).toBe("legacy.txt");
  });

  test("rejects unsupported document types", async () => {
    const profileId = "profile_kb_reject";
    await setupProfile(profileId);

    await expect(
      uploadKnowledgeBaseDocument(ORG_ID, profileId, {
        data: Buffer.from("zip").toString("base64"),
        filename: "archive.zip",
        mediaType: "application/zip",
      })
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
      "knowledge-base"
    );
    await mkdir(path.join(legacyDir, "extracted"), { recursive: true });
    await mkdir(path.join(legacyDir, "uploads", "kb_legacy"), {
      recursive: true,
    });
    await writeFile(
      path.join(legacyDir, "manifest.json"),
      JSON.stringify(
        {
          documents: [
            {
              filename: "legacy.txt",
              id: "kb_legacy",
              mediaType: "text/plain",
              sizeBytes: 11,
              status: "ready",
              uploadedAt: "2026-06-13T00:00:00.000Z",
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      path.join(legacyDir, "extracted", "kb_legacy.txt"),
      "# source: legacy.txt\n\nlegacy body\n",
      "utf8"
    );
    await writeFile(
      path.join(legacyDir, "uploads", "kb_legacy", "legacy.txt"),
      "legacy body\n",
      "utf8"
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
          "manifest.json"
        ),
        "utf8"
      )
    ).toContain('"documents"');
    expect(
      await readFile(
        path.join(
          tempConfigDir,
          "orgs",
          ORG_ID,
          "profiles",
          profileId,
          "knowledge-base",
          "kb_legacy.extracted.txt"
        ),
        "utf8"
      )
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
          "kb_legacy--legacy.txt"
        ),
        "utf8"
      )
    ).toContain("legacy body");
    await expect(
      readFile(path.join(legacyDir, "manifest.json"), "utf8")
    ).rejects.toThrow();
  });

  test("readKnowledgeBaseDocumentContent strips header for text preview and serves original for download", async () => {
    const profileId = "profile_kb_read";
    await setupProfile(profileId);

    const uploaded = await uploadKnowledgeBaseDocument(ORG_ID, profileId, {
      data: Buffer.from("needle in haystack", "utf8").toString("base64"),
      filename: "notes.txt",
      mediaType: "text/plain",
    });

    const preview = await readKnowledgeBaseDocumentContent(
      ORG_ID,
      profileId,
      uploaded.document.id,
      { render: "text" }
    );
    expect(preview.contentType).toBe("text/plain");
    expect(preview.filename).toBe("notes.txt");
    expect(preview.bytes.toString("utf8")).toBe("needle in haystack");

    const download = await readKnowledgeBaseDocumentContent(
      ORG_ID,
      profileId,
      uploaded.document.id
    );
    expect(download.contentType).toBe("text/plain");
    expect(download.bytes.toString("utf8")).toBe("needle in haystack");
  });

  test("readKnowledgeBaseDocumentContent throws for missing documents", async () => {
    const profileId = "profile_kb_missing";
    await setupProfile(profileId);

    await expect(
      readKnowledgeBaseDocumentContent(ORG_ID, profileId, "kb_nope", {
        render: "text",
      })
    ).rejects.toThrow(/not found/);
  });
});
