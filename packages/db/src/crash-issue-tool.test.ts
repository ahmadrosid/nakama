import { expect, test } from "bun:test";
import { CRASH_ISSUE_TOOL_ID, isProtectedToolId } from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";
import {
  ensureCrashIssueToolDefinition,
  seedOrgDefaultProfile,
  seedOrgSuperBotProfile,
} from "./org-profiles";
import { ensureBuiltinToolDefinitions } from "./seed";

test("the tool is seeded so it can be assigned by hand", async () => {
  const db = createInMemoryDatabaseAdapter();
  await ensureCrashIssueToolDefinition(db);

  const tool = await db.getTool(CRASH_ISSUE_TOOL_ID);

  expect(tool?.name).toBe("crash_issue");
  expect(tool?.handlerType).toBe("builtin");
});

test("no profile gets it automatically", async () => {
  const db = createInMemoryDatabaseAdapter();
  await ensureBuiltinToolDefinitions(db);
  await ensureCrashIssueToolDefinition(db);

  // A profile reachable from Telegram or WhatsApp must not be able to open issues on the
  // maintainer's repository just because it exists.
  const defaultProfile = await seedOrgDefaultProfile(db, "org_a");
  const superBot = await seedOrgSuperBotProfile(db, "org_a");

  for (const profile of [defaultProfile, superBot]) {
    const toolIds = (await db.listToolsForProfile(profile.id)).map((tool) => tool.id);
    expect(toolIds).not.toContain(CRASH_ISSUE_TOOL_ID);
  }
});

test("it cannot be deleted like an ordinary custom tool", () => {
  expect(isProtectedToolId(CRASH_ISSUE_TOOL_ID)).toBe(true);
});
