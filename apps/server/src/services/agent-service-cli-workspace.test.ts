import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as core from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";

const ORG_ID = "org_test";

function privateServiceAccess<T>(service: AgentService): T {
  // SAFETY: Tests use named interfaces for private service members.
  return Object.create(service) as T;
}

describe("AgentService CLI coding workspace", () => {
  test("keeps the CLI coding workspace root when it rebuilds a session from the DB", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);
    const repo = mkdtempSync(path.join(tmpdir(), "nakama-cli-repo-"));

    const { sessions } = privateServiceAccess<{
      sessions: Map<string, unknown>;
    }>(service);

    using buildContext = spyOn(core, "buildToolExecutionContext");

    try {
      const sessionId = await service.createSession(
        ORG_ID,
        "cli",
        "profile_default",
        undefined,
        { codingWorkspaceRoot: repo }
      );

      await db.replaceMessagesForSession(sessionId, [
        {
          createdAt: new Date().toISOString(),
          id: "msg_1",
          payload: { content: "hi", role: "user" },
          seq: 0,
          sessionId,
        },
      ]);

      sessions.clear();
      await service.resolveSession(sessionId, ORG_ID);
      const branch = await service.branchSession(sessionId, 0, ORG_ID);

      const childId = await service.createChildSession(
        sessionId,
        ORG_ID,
        "child",
        { isPlatformAdmin: true }
      );

      const roots = buildContext.mock.calls.map(
        ([input]) => input.codingWorkspaceRoot
      );

      expect(roots.length).toBeGreaterThanOrEqual(4);
      expect(new Set(roots)).toEqual(new Set([repo]));
      expect((await db.getSession(childId))?.codingWorkspaceRoot).toBe(repo);
      expect(
        branch && (await db.getSession(branch.sessionId))?.codingWorkspaceRoot
      ).toBe(repo);
    } finally {
      rmSync(repo, { force: true, recursive: true });
    }
  });

  test("falls back to the profile workspace when the stored CLI folder is gone", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);
    const repo = mkdtempSync(path.join(tmpdir(), "nakama-cli-repo-"));

    const { sessions } = privateServiceAccess<{
      sessions: Map<string, unknown>;
    }>(service);

    const sessionId = await service.createSession(
      ORG_ID,
      "cli",
      "profile_default",
      undefined,
      { codingWorkspaceRoot: repo }
    );

    rmSync(repo, { force: true, recursive: true });
    sessions.clear();

    using buildContext = spyOn(core, "buildToolExecutionContext");
    await service.resolveSession(sessionId, ORG_ID);

    expect(buildContext).toHaveBeenCalled();
    expect(
      buildContext.mock.calls.every(
        ([input]) => input.codingWorkspaceRoot === undefined
      )
    ).toBe(true);
  });

  test("only the local CLI can run turns in a chat with a stored CLI folder", async () => {
    const db = createInMemoryDatabaseAdapter();
    await db.upsertProfile(createDefaultProfile());
    const service = new AgentService(null, null, db);

    const sessionId = await service.createSession(
      ORG_ID,
      "cli",
      "profile_default",
      undefined,
      { codingWorkspaceRoot: tmpdir() }
    );

    const access = { isPlatformAdmin: true };

    await expect(
      service.assertSessionProfileAccess(sessionId, ORG_ID, access, {
        localClient: false,
      })
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      service.assertSessionProfileAccess(sessionId, ORG_ID, access, {
        localClient: true,
      })
    ).resolves.toBeUndefined();

    await expect(
      service.assertSessionProfileAccess(sessionId, ORG_ID, access)
    ).resolves.toBeUndefined();
  });
});
