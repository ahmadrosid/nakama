import { describe, expect, test } from "bun:test";
import {
  LIST_PROFILE_SESSIONS_TOOL_ID,
  READ_PROFILE_SESSION_TOOL_ID,
} from "@nakama/core/tools/protected";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { createSessionTools } from "../tools/session-tools";
import { AgentService } from "./agent-service";
import { resolveToolsFromStorage } from "./tool-resolver";

function sessionTools() {
  return createSessionTools(
    new AgentService(null, null, createInMemoryDatabaseAdapter())
  );
}

async function seedSessionToolRows(
  db: ReturnType<typeof createInMemoryDatabaseAdapter>
) {
  const now = new Date().toISOString();
  const rows = [
    { id: LIST_PROFILE_SESSIONS_TOOL_ID, name: "list_profile_sessions" },
    { id: READ_PROFILE_SESSION_TOOL_ID, name: "read_profile_session" },
  ];

  for (const row of rows) {
    await db.upsertTool({
      createdAt: now,
      description: row.name,
      handlerConfig: {},
      handlerType: "session",
      id: row.id,
      name: row.name,
      updatedAt: now,
    });
  }
}

describe("resolveToolsFromStorage session", () => {
  test("resolves both registered session tools from storage", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedSessionToolRows(db);

    const names = (
      await resolveToolsFromStorage(await db.listTools(), db, [], {
        serverTools: { session: sessionTools() },
      })
    ).map((tool) => tool.name);

    expect(names).toContain("list_profile_sessions");
    expect(names).toContain("read_profile_session");
  });

  test("resolves nothing when the tools were never registered", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedSessionToolRows(db);

    const names = (
      await resolveToolsFromStorage(await db.listTools(), db, [], {
        serverTools: { session: [] },
      })
    ).map((tool) => tool.name);

    expect(names).not.toContain("list_profile_sessions");
    expect(names).not.toContain("read_profile_session");
  });
});
