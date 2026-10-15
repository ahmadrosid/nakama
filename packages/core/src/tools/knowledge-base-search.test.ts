import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PublishedKnowledgeBaseDocument } from "../contract";
import {
  getKnowledgeBaseDir,
  getKnowledgeBaseExtractedPath,
  getOrgKnowledgeBaseDir,
} from "../knowledge-base/paths";
import { runWriteFile } from "./builtin";
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
    additionalProfileDocuments?: DocumentFixture[];
    attachments?: string[];
    organization?: DocumentFixture[];
    profile: DocumentFixture;
    /** Listed in the manifest as failed, with no extracted file on disk. */
    unreadable?: { filename: string; id: string }[];
  }): Promise<string> {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-kb-search-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const profileKnowledgeBaseDir = getKnowledgeBaseDir(ORG_ID, PROFILE_ID);
    await mkdir(profileKnowledgeBaseDir, { recursive: true });

    const profileDocuments = [
      options.profile,
      ...(options.additionalProfileDocuments ?? []),
    ];

    for (const document of profileDocuments) {
      await writeFile(
        getKnowledgeBaseExtractedPath(profileKnowledgeBaseDir, document.id),
        extractedContent(document.filename, document.body),
        "utf8"
      );
    }

    const manifest = {
      documents: [
        ...profileDocuments.map(manifestDocument),
        ...(options.unreadable ?? []).map((document) => ({
          error: "unsupported input: PDF has no extractable text",
          filename: document.filename,
          id: document.id,
          mediaType: "application/pdf",
          sizeBytes: 1024,
          status: "failed" as const,
          uploadedAt: UPLOADED_AT,
        })),
      ],
    };

    if (options.attachments) {
      Object.assign(manifest, { sharedDocumentIds: options.attachments });
    }

    await writeFile(
      path.join(profileKnowledgeBaseDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
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

  test.each([
    { memory: false, regex: true },
    { memory: false, regex: false },
    { memory: true, regex: true },
    { memory: true, regex: false },
  ])(
    "parent search regex=$regex memory=$memory reads only live publications",
    async ({ regex, memory }) => {
      await setupTwoScopes();
      const parentRoot = getOrgKnowledgeBaseDir("org_parent");
      await mkdir(parentRoot, { recursive: true });
      await writeFile(
        getKnowledgeBaseExtractedPath(parentRoot, "kb_published"),
        extractedContent("same.txt", "parentneedle authorized fact")
      );
      await writeFile(
        getKnowledgeBaseExtractedPath(parentRoot, "kb_private"),
        extractedContent("same.txt", "privateneedle unpublished secret")
      );

      const document: PublishedKnowledgeBaseDocument = {
        filename: "same.txt",
        id: "kb_published",
        mediaType: "text/plain",
        publicationId: "publication_1",
        scope: "parent",
        sizeBytes: 32,
        sourceOrganization: { id: "org_parent", name: "Parent" },
        status: "ready",
        uploadedAt: UPLOADED_AT,
      };

      let publications = [document];
      let lookups = 0;

      const context = {
        listPublishedKnowledgeDocuments: async () => {
          lookups++;

          return publications;
        },
        orgId: ORG_ID,
        profileId: PROFILE_ID,
        searchKnowledge: memory
          ? async () => ({
              matches: [
                { file: "memory.md", line: 1, text: "Team memory fact" },
              ],
              truncated: false,
            })
          : undefined,
      };

      const initial = await runKnowledgeBaseSearch(
        { query: "parentneedle", regex },
        context
      );

      const parentMatches = initial.matches.filter(
        (match) => match.scope === "parent"
      );

      expect(parentMatches).toHaveLength(1);
      expect(parentMatches[0]).toMatchObject({
        publicationId: "publication_1",
        sourceOrganization: document.sourceOrganization,
      });
      expect(parentMatches[0]?.file).toBe("kb_published.extracted.txt");
      expect(initial.root).toBe(getKnowledgeBaseDir(ORG_ID, PROFILE_ID));
      expect(
        initial.matches.filter((match) => match.scope === "profile")
      ).toHaveLength(memory ? 1 : 0);

      const filtered = await runKnowledgeBaseSearch(
        { filename: "same.txt", query: "parentneedle", regex },
        context
      );

      expect(
        filtered.matches.filter((match) => match.scope === "parent")
      ).toHaveLength(1);

      const privateResult = await runKnowledgeBaseSearch(
        { query: "privateneedle", regex },
        context
      );

      expect(
        privateResult.matches.filter((match) => match.scope === "parent")
      ).toEqual([]);
      expect(JSON.stringify(privateResult)).not.toContain("unpublished secret");
      publications = [];

      const revoked = await runKnowledgeBaseSearch(
        { query: "parentneedle", regex },
        context
      );

      expect(
        revoked.matches.filter((match) => match.scope === "parent")
      ).toEqual([]);
      expect(lookups).toBe(4);
    }
  );

  test.each([true, false])(
    "parent search rejects an extracted symlink for regex=%s",
    async (regex) => {
      const profileDir = await setupTwoScopes();
      const parentRoot = getOrgKnowledgeBaseDir("org_parent");
      await mkdir(parentRoot, { recursive: true });
      const secret = path.join(profileDir, "secret.txt");
      await writeFile(secret, "Private team secret");
      await symlink(
        secret,
        getKnowledgeBaseExtractedPath(parentRoot, "kb_published")
      );
      await expect(
        runKnowledgeBaseSearch(
          { query: "secret", regex },
          {
            listPublishedKnowledgeDocuments: async () => [
              {
                filename: "shared.txt",
                id: "kb_published",
                mediaType: "text/plain",
                publicationId: "publication_1",
                scope: "parent",
                sizeBytes: 19,
                sourceOrganization: { id: "org_parent", name: "Parent" },
                status: "ready",
                uploadedAt: UPLOADED_AT,
              },
            ],
            orgId: ORG_ID,
            profileId: PROFILE_ID,
          }
        )
      ).rejects.toThrow();
    }
  );

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

  test.each([true, false])(
    "finds wiki pages the agent wrote into the knowledge base for regex=%s",
    async (regex) => {
      await setupTwoScopes();
      const context = { orgId: ORG_ID, profileId: PROFILE_ID };

      await runWriteFile(
        {
          content: `---\nsources: [${PRIVATE_DOCUMENT_ID}]\n---\n\n# Billing\n\nInvoices settle on the fifteenth.\n`,
          path: "knowledge-base/wiki/billing.md",
        },
        context
      );

      const result = await runKnowledgeBaseSearch(
        { query: "fifteenth", regex },
        context
      );

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?.file).toEndWith(
        path.join("knowledge-base", "wiki", "billing.md")
      );
    }
  );

  test("matches stems and prefixes, and honors exclusions", async () => {
    await setupKnowledgeBase({
      additionalProfileDocuments: [
        {
          body: "deployed services nightly\nrollback plan\n",
          filename: "ops.txt",
          id: "kb_ops",
        },
      ],
      profile: {
        body: "deploying checklist\nrollback skipped\n",
        filename: "checklist.txt",
        id: "kb_checklist",
      },
    });

    const context = { orgId: ORG_ID, profileId: PROFILE_ID };

    const stemmed = await runKnowledgeBaseSearch({ query: "deploy" }, context);

    expect(stemmed.matchCount).toBe(2);

    const excluded = await runKnowledgeBaseSearch(
      { query: "rollback -skipped" },
      context
    );

    expect(excluded.matchCount).toBe(1);
    expect(excluded.matches[0]?.text).toContain("rollback plan");
  });

  test("points the snippet at the line that matched a stem", async () => {
    await setupKnowledgeBase({
      profile: {
        body: "Office hours are nine to five.\nParking is free.\nTo change a password, open Settings.\nRefund rule from the password page.\n",
        filename: "handbook.txt",
        id: "kb_handbook",
      },
    });

    const context = { orgId: ORG_ID, profileId: PROFILE_ID };

    const stemmed = await runKnowledgeBaseSearch(
      { query: "passwords" },
      context
    );

    expect(stemmed.matches[0]?.line).toBe(7);

    const excluded = await runKnowledgeBaseSearch(
      { query: "password -refund" },
      context
    );

    expect(excluded.matchCount).toBe(0);

    const phrase = await runKnowledgeBaseSearch(
      { query: '"password page"' },
      context
    );

    expect(phrase.matches[0]?.line).toBe(8);
  });

  test("falls back to any term only when no document holds every term", async () => {
    await setupKnowledgeBase({
      additionalProfileDocuments: [
        {
          body: "Parking is free for staff.\n",
          filename: "parking.txt",
          id: "kb_parking",
        },
        {
          body: "Change the password every quarter.\nRotate keys yearly.\n",
          filename: "security.txt",
          id: "kb_security",
        },
      ],
      profile: {
        body: "To change a password, open Settings and choose Security.\n",
        filename: "handbook.txt",
        id: "kb_handbook",
      },
    });

    const context = { orgId: ORG_ID, profileId: PROFILE_ID };

    const question = await runKnowledgeBaseSearch(
      { query: "how do I change my password" },
      context
    );

    expect(question.matches.map((match) => path.basename(match.file))).toEqual(
      expect.arrayContaining([
        "kb_handbook.extracted.txt",
        "kb_security.extracted.txt",
      ])
    );
    expect(question.matches.map((match) => match.file)).not.toContain(
      path.join("knowledge-base", "kb_parking.extracted.txt")
    );

    const strict = await runKnowledgeBaseSearch(
      { query: "password settings" },
      context
    );

    expect(strict.matches.map((match) => path.basename(match.file))).toEqual([
      "kb_handbook.extracted.txt",
    ]);

    const excluded = await runKnowledgeBaseSearch(
      { query: "how to change password -quarter" },
      context
    );

    expect(excluded.matches.map((match) => path.basename(match.file))).toEqual([
      "kb_handbook.extracted.txt",
    ]);
  });

  test("reindexes a document after its content changes", async () => {
    await setupKnowledgeBase({
      profile: {
        body: "first version zebra\n",
        filename: "notes.txt",
        id: "kb_changing",
      },
    });

    const context = { orgId: ORG_ID, profileId: PROFILE_ID };

    expect(
      (await runKnowledgeBaseSearch({ query: "zebra" }, context)).matchCount
    ).toBe(1);

    await writeFile(
      getKnowledgeBaseExtractedPath(
        getKnowledgeBaseDir(ORG_ID, PROFILE_ID),
        "kb_changing"
      ),
      extractedContent("notes.txt", "second version giraffe and more text\n"),
      "utf8"
    );

    expect(
      (await runKnowledgeBaseSearch({ query: "zebra" }, context)).matchCount
    ).toBe(0);

    expect(
      (await runKnowledgeBaseSearch({ query: "giraffe" }, context)).matchCount
    ).toBe(1);
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

  test("finds reordered keywords and preserves readable profile paths", async () => {
    await setupKnowledgeBase({
      profile: {
        body: "alpha project fact\n",
        filename: "notes.txt",
        id: PRIVATE_DOCUMENT_ID,
      },
    });

    const result = await runKnowledgeBaseSearch(
      { query: "fact alpha" },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );

    expect(result.matchCount).toBe(1);
    expect(result.matches[0]?.text).toContain("alpha project fact");
    expect(result.matches[0]?.file).toBe(
      path.join("knowledge-base", `${PRIVATE_DOCUMENT_ID}.extracted.txt`)
    );
  });

  test("matches regular expressions when explicitly requested", async () => {
    await setupTwoScopes();

    const result = await runKnowledgeBaseSearch(
      { query: "private.*context", regex: true },
      { orgId: ORG_ID, profileId: PROFILE_ID }
    );

    expect(result.matchCount).toBe(1);
    expect(result.matches[0]?.text).toContain("private alpha context");
  });

  test("keeps concurrent filename searches in their own scope", async () => {
    await setupTwoScopes();

    const results = await Promise.all(
      ["private.txt", "shared.txt", "private.txt", "shared.txt"].map(
        (filename) =>
          runKnowledgeBaseSearch(
            { filename, query: "alpha" },
            { orgId: ORG_ID, profileId: PROFILE_ID }
          )
      )
    );

    for (const [index, result] of results.entries()) {
      expect(result.matchCount).toBe(1);
      expect(result.matches[0]?.scope).toBe(
        index % 2 === 0 ? "profile" : "organization"
      );
    }
  });

  test("searches updated text and excludes removed files", async () => {
    await setupKnowledgeBase({
      profile: {
        body: "alpha project fact\n",
        filename: "notes.txt",
        id: PRIVATE_DOCUMENT_ID,
      },
    });
    const context = { orgId: ORG_ID, profileId: PROFILE_ID };
    expect(
      (await runKnowledgeBaseSearch({ query: "alpha" }, context)).matchCount
    ).toBe(1);

    const source = getKnowledgeBaseExtractedPath(
      getKnowledgeBaseDir(ORG_ID, PROFILE_ID),
      PRIVATE_DOCUMENT_ID
    );

    await writeFile(
      source,
      extractedContent("notes.txt", "gamma project fact\n")
    );
    expect(
      (await runKnowledgeBaseSearch({ query: "alpha" }, context)).matchCount
    ).toBe(0);
    expect(
      (await runKnowledgeBaseSearch({ query: "gamma" }, context)).matchCount
    ).toBe(1);
    await rm(source);
    expect(
      (await runKnowledgeBaseSearch({ query: "gamma" }, context)).matchCount
    ).toBe(0);
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

    expect(result.matches.map((match) => match.scope)).not.toContain(
      "organization"
    );
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
      additionalProfileDocuments: [
        { body: "budget marker four\n", filename: "other.txt", id: "kb_other" },
      ],
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

  test("names documents that hold no searchable text", async () => {
    const workspaceRoot = await setupKnowledgeBase({
      profile: {
        body: "confined space entry needs a permit\n",
        filename: "permits.txt",
        id: PRIVATE_DOCUMENT_ID,
      },
      unreadable: [{ filename: "working-at-height.pdf", id: "kb_scanned" }],
    });

    const result = await runKnowledgeBaseSearch(
      { query: "working at height" },
      { orgId: ORG_ID, profileId: PROFILE_ID },
      { workspaceRoot }
    );

    // Zero matches on their own read as "nobody uploaded anything on this",
    // which is the wrong conclusion to hand an agent when the document is
    // sitting there unreadable.
    expect(result.matchCount).toBe(0);
    expect(result.unreadable).toEqual(["working-at-height.pdf"]);
  });

  test("omits the unreadable field when every document extracted", async () => {
    const workspaceRoot = await setupKnowledgeBase({
      profile: {
        body: "confined space entry needs a permit\n",
        filename: "permits.txt",
        id: PRIVATE_DOCUMENT_ID,
      },
    });

    // Not "permit": the extracted header line carries the filename, so that
    // query matches twice and the count stops meaning what it looks like.
    const result = await runKnowledgeBaseSearch(
      { query: "confined" },
      { orgId: ORG_ID, profileId: PROFILE_ID },
      { workspaceRoot }
    );

    expect(result.matchCount).toBe(1);
    expect(result.unreadable).toBeUndefined();
  });

  test("reports truncation only when a match is actually dropped", async () => {
    await setupKnowledgeBase({
      additionalProfileDocuments: [
        { body: "limit marker two\n", filename: "second.txt", id: "kb_second" },
        { body: "limit marker three\n", filename: "third.txt", id: "kb_third" },
      ],
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
