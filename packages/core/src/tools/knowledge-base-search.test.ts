import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  getOrgKnowledgeBaseDir,
} from "../knowledge-base/paths";
import { runKnowledgeBaseSearch } from "./knowledge-base-search";

const ORG_ID = "org_test";
const PROFILE_ID = "profile_kb_search";
const PRIVATE_DOCUMENT_ID = "kb_private";
const SHARED_DOCUMENT_ID = "kb_shared";
const UNSHARED_DOCUMENT_ID = "kb_unshared";
const UPLOADED_AT = "2026-06-13T00:00:00.000Z";

interface DocumentFixture {
  body: string;
  filename: string;
  id: string;
}

describe("knowledge_base_search tool", () => {
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

  function extractedContent(filename: string, body: string): string {
    return `# source: ${filename}\n# mediaType: text/plain\n# uploadedAt: ${UPLOADED_AT}\n\n${body}`;
  }

  function manifestDocument(document: DocumentFixture) {
    return {
      filename: document.filename,
      id: document.id,
      mediaType: "text/plain",
      sizeBytes: document.body.length,
      status: "ready" as const,
      uploadedAt: UPLOADED_AT,
    };
  }

  async function setupKnowledgeBase(options: {
    attachments?: string[];
    organization?: DocumentFixture[];
    profile: DocumentFixture;
  }): Promise<string> {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-kb-search-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const profileKnowledgeBaseDir = getKnowledgeBaseDir(ORG_ID, PROFILE_ID);
    await mkdir(profileKnowledgeBaseDir, { recursive: true });
    await writeFile(
      getKnowledgeBaseExtractedPath(
        profileKnowledgeBaseDir,
        options.profile.id
      ),
      extractedContent(options.profile.filename, options.profile.body),
      "utf8"
    );
    await writeFile(
      path.join(profileKnowledgeBaseDir, "manifest.json"),
      JSON.stringify(
        {
          documents: [manifestDocument(options.profile)],
          ...(options.attachments
            ? { sharedDocumentIds: options.attachments }
            : {}),
        },
        null,
        2
      ),
      "utf8"
    );

    const organizationKnowledgeBaseDir = getOrgKnowledgeBaseDir(ORG_ID);
    await mkdir(organizationKnowledgeBaseDir, { recursive: true });
    const organization = options.organization ?? [];
    if (organization.length > 0) {
      await writeFile(
        path.join(organizationKnowledgeBaseDir, "manifest.json"),
        JSON.stringify(
          { documents: organization.map(manifestDocument) },
          null,
          2
        ),
        "utf8"
      );
    }
    for (const document of organization) {
      await writeFile(
        getKnowledgeBaseExtractedPath(
          organizationKnowledgeBaseDir,
          document.id
        ),
        extractedContent(document.filename, document.body),
        "utf8"
      );
    }

    return path.join(tempConfigDir, "orgs", ORG_ID, "profiles", PROFILE_ID);
  }

  async function setupTwoScopes(attachments: string[] = [SHARED_DOCUMENT_ID]) {
    return await setupKnowledgeBase({
      attachments,
      organization: [
        {
          body: "shared alpha context\n",
          filename: "shared.txt",
          id: SHARED_DOCUMENT_ID,
        },
        {
          body: "secret-unattached-token\n",
          filename: "unshared.txt",
          id: UNSHARED_DOCUMENT_ID,
        },
      ],
      profile: {
        body: "private alpha context\n",
        filename: "private.txt",
        id: PRIVATE_DOCUMENT_ID,
      },
    });
  }

  test("searches all knowledge base files", async () => {
    const profileDir = await setupKnowledgeBase({
      profile: {
        body: "alpha project fact\nbeta line\n",
        filename: "notes.txt",
        id: "kb_test_doc",
      },
    });
    await writeFile(
      path.join(profileDir, "SOUL.md"),
      "alpha soul content\n",
      "utf8"
    );

    const result = await runKnowledgeBaseSearch(
      { query: "project fact" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );

    expect(result.matchCount).toBe(1);
    expect(result.matches[0]?.text).toContain("alpha project fact");
    expect(result.root).toBe(getKnowledgeBaseDir(ORG_ID, PROFILE_ID));

    const soulOnly = await runKnowledgeBaseSearch(
      { query: "soul content" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );
    expect(soulOnly.matchCount).toBe(0);
  });

  test("includes only shared organization documents attached to the profile", async () => {
    await setupTwoScopes();

    const shared = await runKnowledgeBaseSearch(
      { query: "shared alpha" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );
    expect(shared.matchCount).toBe(1);
    expect(shared.matches[0]?.scope).toBe("organization");

    const unattached = await runKnowledgeBaseSearch(
      { query: "secret-unattached-token" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );
    expect(unattached.matchCount).toBe(0);

    const filteredBySharedFilename = await runKnowledgeBaseSearch(
      { filename: "shared.txt", query: "alpha" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );
    expect(filteredBySharedFilename.matchCount).toBe(1);
    expect(filteredBySharedFilename.matches[0]?.scope).toBe("organization");

    const filteredByUnattachedFilename = await runKnowledgeBaseSearch(
      { filename: "unshared.txt", query: "alpha" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );
    expect(filteredByUnattachedFilename.matchCount).toBe(0);
  });

  test("merges profile and organization matches in one query", async () => {
    await setupTwoScopes();

    const result = await runKnowledgeBaseSearch(
      { query: "alpha" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );

    expect(result.matchCount).toBe(2);
    expect(result.matches.map((match) => match.scope).sort()).toEqual([
      "organization",
      "profile",
    ]);
    expect(
      result.matches.some((match) => match.text.includes("private alpha"))
    ).toBe(true);
    expect(
      result.matches.some((match) => match.text.includes("shared alpha"))
    ).toBe(true);
  });

  test("keeps attached organization documents searchable when the memory backend answers", async () => {
    await setupTwoScopes();

    const backendMatches = [
      {
        file: "knowledge-base/kb_private.extracted.txt",
        line: 5,
        text: "private alpha context",
      },
    ];
    const withBackend = await runKnowledgeBaseSearch(
      { query: "alpha" },
      {
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        searchKnowledge: async () => ({
          matches: backendMatches,
          truncated: false,
        }),
      }
    );

    expect(withBackend.matchCount).toBe(2);
    expect(withBackend.matches.map((match) => match.scope)).toEqual([
      "profile",
      "organization",
    ]);
    expect(withBackend.matches[1]?.text).toContain("shared alpha context");

    const unattachedWithBackend = await runKnowledgeBaseSearch(
      { query: "secret-unattached-token" },
      {
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        searchKnowledge: async () => ({
          matches: [],
          truncated: false,
        }),
      }
    );
    expect(unattachedWithBackend.matchCount).toBe(0);
  });

  test("skips organization matches when nothing is attached", async () => {
    await setupTwoScopes([]);

    const result = await runKnowledgeBaseSearch(
      { query: "shared alpha" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );

    expect(result.matchCount).toBe(0);
  });

  test("filters by source filename", async () => {
    await setupKnowledgeBase({
      profile: {
        body: "unique-token-here\n",
        filename: "notes.txt",
        id: "kb_test_doc",
      },
    });

    const missing = await runKnowledgeBaseSearch(
      { filename: "missing.txt", query: "unique-token" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );
    expect(missing.matchCount).toBe(0);

    const found = await runKnowledgeBaseSearch(
      { filename: "notes.txt", query: "unique-token" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );
    expect(found.matchCount).toBe(1);
  });

  test("reports organization hits relative to the organization root", async () => {
    await setupTwoScopes();

    const result = await runKnowledgeBaseSearch(
      { query: "shared alpha" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );

    expect(result.matches[0]?.scope).toBe("organization");
    expect(result.matches[0]?.file).toBe(`${SHARED_DOCUMENT_ID}.extracted.txt`);
  });

  test("keeps a slot for organization hits when the profile scope fills maxResults", async () => {
    await setupKnowledgeBase({
      attachments: [SHARED_DOCUMENT_ID],
      organization: [
        {
          body: "shared budget marker\n",
          filename: "shared.txt",
          id: SHARED_DOCUMENT_ID,
        },
      ],
      profile: {
        body: "budget marker one\nbudget marker two\nbudget marker three\n",
        filename: "private.txt",
        id: PRIVATE_DOCUMENT_ID,
      },
    });

    const result = await runKnowledgeBaseSearch(
      { maxResults: 2, query: "budget marker" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );

    expect(result.matchCount).toBe(2);
    expect(result.matches.map((match) => match.scope).sort()).toEqual([
      "organization",
      "profile",
    ]);
    expect(
      result.matches.some((match) =>
        match.text.includes("shared budget marker")
      )
    ).toBe(true);
    // The profile scope had to drop a match to keep the organization slot.
    expect(result.truncated).toBe(true);
  });

  test("reports truncation only when a match is actually dropped", async () => {
    await setupKnowledgeBase({
      profile: {
        body: "limit marker one\nlimit marker two\nlimit marker three\n",
        filename: "private.txt",
        id: PRIVATE_DOCUMENT_ID,
      },
    });

    const exact = await runKnowledgeBaseSearch(
      { maxResults: 3, query: "limit marker" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );
    expect(exact.matchCount).toBe(3);
    expect(exact.truncated).toBe(false);

    const dropped = await runKnowledgeBaseSearch(
      { maxResults: 2, query: "limit marker" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );
    expect(dropped.matchCount).toBe(2);
    expect(dropped.truncated).toBe(true);
  });

  test("does not report truncation when both scopes land on the merged limit", async () => {
    await setupTwoScopes();

    const result = await runKnowledgeBaseSearch(
      { maxResults: 2, query: "alpha" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );

    expect(result.matchCount).toBe(2);
    expect(result.truncated).toBe(false);
  });
});
