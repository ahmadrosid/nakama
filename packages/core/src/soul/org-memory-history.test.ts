import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendOrgMemoryHistory,
  createOrgMemoryChangeId,
  getOrgMemoryHistoryEntry,
  listOrgMemoryHistory,
  ORG_MEMORY_HISTORY_MAX_ENTRIES,
  pruneOrgMemoryHistory,
} from "./org-memory-history";
import { getOrgMemoryHistoryDir } from "./resolve";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;

describe("org memory history", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { force: true, recursive: true });
      tempDir = "";
    }
    if (originalConfigDir === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
    }
  });

  async function setupOrg(orgId = "org_a"): Promise<string> {
    tempDir = await mkdtemp(
      path.join(os.tmpdir(), "nakama-org-memory-history-")
    );
    process.env.NAKAMA_CONFIG_DIR = tempDir;
    return orgId;
  }

  async function writeHistoryRevision(
    orgId: string,
    id: string,
    createdAt: string,
    content: string,
    metadata?: string
  ): Promise<void> {
    const historyDir = getOrgMemoryHistoryDir(orgId, tempDir);
    await mkdir(historyDir, { recursive: true });
    await writeFile(
      path.join(historyDir, `${id}.json`),
      metadata ??
        JSON.stringify({
          action: "edit",
          actorUserId: "user_a",
          createdAt,
          id,
          label: id,
          orgId,
        })
    );
    await writeFile(path.join(historyDir, `${id}.md`), content);
  }

  test("appends and lists history entries newest first", async () => {
    const orgId = await setupOrg();
    const firstId = createOrgMemoryChangeId();
    const secondId = createOrgMemoryChangeId();

    await appendOrgMemoryHistory(
      orgId,
      {
        action: "edit",
        actorUserId: "user_a",
        createdAt: "2026-07-31T08:00:00.000Z",
        id: firstId,
        label: "First edit",
        orgId,
      },
      "## Org Memory\n\n## Pinned\n\n- first\n"
    );
    await appendOrgMemoryHistory(
      orgId,
      {
        action: "approve",
        actorUserId: "user_a",
        createdAt: "2026-07-31T09:00:00.000Z",
        id: secondId,
        label: "Approved proposal",
        orgId,
      },
      "## Org Memory\n\n## Pinned\n\n- second\n"
    );

    const changes = await listOrgMemoryHistory(orgId);
    expect(changes.map((entry) => entry.id)).toEqual([secondId, firstId]);
    await expect(
      getOrgMemoryHistoryEntry(orgId, secondId)
    ).resolves.toMatchObject({
      content: "## Org Memory\n\n## Pinned\n\n- second\n",
      label: "Approved proposal",
    });
  });

  test("prunes history beyond the configured max entries", async () => {
    const orgId = await setupOrg();

    for (
      let index = 0;
      index < ORG_MEMORY_HISTORY_MAX_ENTRIES + 3;
      index += 1
    ) {
      const id = createOrgMemoryChangeId();
      await appendOrgMemoryHistory(
        orgId,
        {
          action: "edit",
          actorUserId: null,
          createdAt: `2026-07-31T10:${String(index).padStart(2, "0")}:00.000Z`,
          id,
          label: `Edit ${index}`,
          orgId,
        },
        `content-${index}\n`
      );
    }

    const changes = await listOrgMemoryHistory(orgId);
    expect(changes).toHaveLength(ORG_MEMORY_HISTORY_MAX_ENTRIES);
    expect(changes[0]?.label).toBe(
      `Edit ${ORG_MEMORY_HISTORY_MAX_ENTRIES + 2}`
    );
  });

  test("skips malformed metadata without leaking its contents", async () => {
    const orgId = await setupOrg();
    const malformedId = "omh_99999999_malformed";
    const validId = "omh_00000001_valid";
    const secret = "private-memory-content";
    await writeHistoryRevision(
      orgId,
      validId,
      "2026-07-31T08:00:00.000Z",
      "valid content"
    );
    await writeHistoryRevision(
      orgId,
      malformedId,
      "2026-07-31T09:00:00.000Z",
      "malformed content",
      `{${secret}`
    );

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => warnings.push(String(message));
    try {
      await expect(listOrgMemoryHistory(orgId, 1, tempDir)).resolves.toEqual([
        expect.objectContaining({ id: validId }),
      ]);
      await expect(
        getOrgMemoryHistoryEntry(orgId, malformedId, tempDir)
      ).resolves.toBeNull();
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(2);
    expect(warnings.every((warning) => warning.includes(malformedId))).toBe(
      true
    );
    expect(warnings.join(" ")).not.toContain(secret);
  });

  test("sorts by creation time before applying a finite limit", async () => {
    const orgId = await setupOrg();
    const olderHighSequenceId = "omh_99999999_before_restart";
    const newerLowSequenceId = "omh_00000001_after_restart";
    await writeHistoryRevision(
      orgId,
      olderHighSequenceId,
      "2026-07-31T08:00:00.000Z",
      "older"
    );
    await writeHistoryRevision(
      orgId,
      newerLowSequenceId,
      "2026-07-31T09:00:00.000Z",
      "newer"
    );

    const changes = await listOrgMemoryHistory(orgId, 1, tempDir);
    expect(changes.map((entry) => entry.id)).toEqual([newerLowSequenceId]);
  });

  test("does not hide non-parse filesystem errors", async () => {
    const orgId = await setupOrg();
    const id = "omh_00000001_unreadable_content";
    await writeHistoryRevision(
      orgId,
      id,
      "2026-07-31T08:00:00.000Z",
      "content"
    );
    const contentPath = path.join(
      getOrgMemoryHistoryDir(orgId, tempDir),
      `${id}.md`
    );
    await rm(contentPath);
    await mkdir(contentPath);

    await expect(
      getOrgMemoryHistoryEntry(orgId, id, tempDir)
    ).rejects.toThrow();
  });

  test("prunes readable entries without deleting malformed files", async () => {
    const orgId = await setupOrg();
    const malformedId = "omh_99999999_malformed";
    await writeHistoryRevision(
      orgId,
      malformedId,
      "2026-07-31T11:00:00.000Z",
      "malformed content",
      "{"
    );
    for (let index = 0; index < 3; index += 1) {
      await writeHistoryRevision(
        orgId,
        `omh_0000000${index + 1}_valid`,
        `2026-07-31T${String(index + 8).padStart(2, "0")}:00:00.000Z`,
        `content-${index}`
      );
    }

    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      await pruneOrgMemoryHistory(orgId, 2, tempDir);
    } finally {
      console.warn = originalWarn;
    }

    const historyDir = getOrgMemoryHistoryDir(orgId, tempDir);
    await expect(
      access(path.join(historyDir, `${malformedId}.json`))
    ).resolves.toBeNull();
    await expect(
      access(path.join(historyDir, `${malformedId}.md`))
    ).resolves.toBeNull();
    await expect(
      access(path.join(historyDir, "omh_00000001_valid.json"))
    ).rejects.toThrow();
  });
});
