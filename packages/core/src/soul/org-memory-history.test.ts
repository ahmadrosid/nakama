import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendOrgMemoryHistory,
  createOrgMemoryChangeId,
  getOrgMemoryHistoryEntry,
  listOrgMemoryHistory,
  ORG_MEMORY_HISTORY_MAX_ENTRIES,
} from "./org-memory-history";

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
});
