import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
} from "../knowledge-base/paths";
import { runKnowledgeBaseSearch } from "./knowledge-base-search";

describe("knowledge_base_search tool", () => {
  let tempConfigDir = "";
  const previousConfigDir = process.env.TINYCLAW_CONFIG_DIR;
  const orgId = "org_test";
  const profileId = "profile_kb_search";

  afterEach(async () => {
    process.env.TINYCLAW_CONFIG_DIR = previousConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  async function setupExtractedFile(filename: string, body: string): Promise<void> {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-kb-search-"));
    process.env.TINYCLAW_CONFIG_DIR = tempConfigDir;

    const profileDir = path.join(tempConfigDir, "orgs", orgId, "profiles", profileId);
    await mkdir(path.join(profileDir, "knowledge-base"), { recursive: true });

    const docId = "kb_test_doc";
    const extractedPath = getKnowledgeBaseExtractedPath(orgId, profileId, docId);
    const header = `# source: ${filename}\n# mediaType: text/plain\n# uploadedAt: 2026-06-13T00:00:00.000Z\n\n`;
    await writeFile(extractedPath, `${header}${body}`, "utf8");

    const manifestPath = path.join(profileDir, "knowledge-base", "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          documents: [
            {
              id: docId,
              filename,
              mediaType: "text/plain",
              sizeBytes: body.length,
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
  }

  test("searches all knowledge base files", async () => {
    await setupExtractedFile("notes.txt", "alpha project fact\nbeta line\n");

    const profileDir = path.join(tempConfigDir, "orgs", orgId, "profiles", profileId);
    await writeFile(path.join(profileDir, "SOUL.md"), "alpha soul content\n", "utf8");

    const result = await runKnowledgeBaseSearch(
      { query: "project fact" },
      { orgId, profileId },
    );

    expect(result.matchCount).toBe(1);
    expect(result.matches[0]?.text).toContain("alpha project fact");
    expect(result.root).toBe(getKnowledgeBaseDir(orgId, profileId));
  });

  test("filters by source filename", async () => {
    await setupExtractedFile("notes.txt", "unique-token-here\n",);

    const missing = await runKnowledgeBaseSearch(
      { query: "unique-token", filename: "missing.txt" },
      { orgId, profileId },
    );
    expect(missing.matchCount).toBe(0);

    const found = await runKnowledgeBaseSearch(
      { query: "unique-token", filename: "notes.txt" },
      { orgId, profileId },
    );
    expect(found.matchCount).toBe(1);
  });
});
