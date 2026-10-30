import { describe, expect, test } from "bun:test";
import { createAgentChatSession } from "@nakama/agent";
import type { ProviderClient } from "@nakama/core";
import type { StoredSessionRecord } from "@nakama/db";
import {
  type ChatBuildContext,
  SessionRuntime,
  sessionKind,
} from "./session-runtime";

const ORG_ID = "org_test";

function record(
  id: string,
  overrides: Partial<StoredSessionRecord> = {}
): StoredSessionRecord {
  return {
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    codingWorkspaceRoot: null,
    createdAt: "2026-10-31T00:00:00.000Z",
    id,
    model: null,
    parentSessionId: null,
    profileId: "profile_default",
    thinkingEffort: null,
    title: null,
    userId: "owner",
    ...overrides,
  };
}

const provider: ProviderClient = {
  generateChat: async () => ({
    assistantMessage: { content: "", role: "assistant" },
    content: "",
    toolCalls: [],
  }),
  generateText: async () => ({ content: "" }),
  name: "openai",
  streamChat: async () => ({
    assistantMessage: { content: "", role: "assistant" },
    content: "",
    toolCalls: [],
  }),
};

interface Build {
  context: ChatBuildContext;
  record: StoredSessionRecord;
}

function setup() {
  const rows = new Map<string, StoredSessionRecord>();

  const builds: Build[] = [];

  const active = new Set<string>();

  const ended: string[] = [];
  let revision = "r1";

  const runtime = new SessionRuntime({
    accessFor: async (_orgId, userId) => ({
      isPlatformAdmin: false,
      orgRole: userId === "owner" ? "member" : null,
    }),
    build: async (built, context) => {
      builds.push({ context, record: { ...built } });

      return createAgentChatSession(
        { provider },
        { initialHistory: context.initialHistory }
      );
    },
    isTurnActive: (id) => active.has(id),
    loadRecord: async (id) => rows.get(id) ?? runtime.cognitoRecord(id) ?? null,
    onCognitoEnd: async (entry) => {
      ended.push(entry.record.id);
    },
    revisionFor: async () => revision,
  });

  return {
    active,
    builds,
    ended,
    rows,
    runtime,
    setRevision: (next: string) => {
      revision = next;
    },
  };
}

describe("SessionRuntime", () => {
  test("builds a stored chat once and rebuilds it the same way after eviction", async () => {
    const { builds, rows, runtime } = setup();
    rows.set("s1", record("s1", { codingWorkspaceRoot: "/repo", model: "m" }));

    const first = await runtime.get("s1", ORG_ID);
    expect(await runtime.get("s1", ORG_ID)).toBe(first);
    expect(builds).toHaveLength(1);

    runtime.invalidateAll();
    await runtime.get("s1", ORG_ID);

    expect(builds).toHaveLength(2);
    expect(builds[1]).toEqual(builds[0]);
    expect(builds[0]?.context).toMatchObject({
      channel: "web",
      kind: "chat",
      orgRole: "member",
    });
  });

  test("returns null for a session the org cannot reach", async () => {
    const { builds, runtime } = setup();

    expect(await runtime.get("missing", ORG_ID)).toBeNull();
    expect(builds).toHaveLength(0);
  });

  test("rebuilds when the capability revision changes", async () => {
    const { builds, rows, runtime, setRevision } = setup();
    rows.set("s1", record("s1"));

    const first = await runtime.get("s1", ORG_ID);
    setRevision("r2");

    expect(await runtime.get("s1", ORG_ID)).not.toBe(first);
    expect(builds).toHaveLength(2);
  });

  test("keeps the running chat during a turn unless a new turn asks", async () => {
    const { active, builds, rows, runtime, setRevision } = setup();
    rows.set("s1", record("s1"));

    const running = await runtime.get("s1", ORG_ID);
    active.add("s1");
    setRevision("r2");

    expect(await runtime.get("s1", ORG_ID)).toBe(running);
    expect(await runtime.get("s1", ORG_ID, { forNewTurn: true })).not.toBe(
      running
    );
    expect(builds).toHaveLength(2);
  });

  test("holds at most 50 stored chats and never evicts one mid-turn", async () => {
    const { active, builds, rows, runtime } = setup();

    for (let index = 0; index < 60; index += 1) {
      rows.set(`s${index}`, record(`s${index}`));
    }

    await runtime.get("s0", ORG_ID);
    active.add("s0");

    for (let index = 1; index < 60; index += 1) {
      await runtime.get(`s${index}`, ORG_ID);
    }

    expect(runtime.peek("s0")).toBeDefined();
    expect(runtime.peek("s1")).toBeUndefined();
    expect(runtime.peek("s59")).toBeDefined();

    const before = builds.length;
    await runtime.get("s1", ORG_ID);
    expect(builds.length).toBe(before + 1);
  });

  test("builds a branch once on first use and passes each kind to the builder", async () => {
    const { builds, rows, runtime } = setup();
    rows.set(
      "branch",
      record("branch", { branchMessageIndex: 0, parentSessionId: "s1" })
    );
    rows.set("child", record("child", { parentSessionId: "s1" }));

    await runtime.get("branch", ORG_ID);
    await runtime.get("branch", ORG_ID);
    await runtime.get("child", ORG_ID);

    expect(builds.map((build) => build.context.kind)).toEqual([
      "branch",
      "child",
    ]);
  });

  test("takes access from the session owner", async () => {
    const { builds, rows, runtime } = setup();
    rows.set("mine", record("mine"));
    rows.set("theirs", record("theirs", { userId: "stranger" }));

    await runtime.get("mine", ORG_ID);
    await runtime.get("theirs", ORG_ID);

    expect(builds.map((build) => build.context.orgRole)).toEqual([
      "member",
      null,
    ]);
  });

  test("drops a stored chat when its run settings change", async () => {
    const { builds, rows, runtime } = setup();
    rows.set("s1", record("s1"));

    await runtime.get("s1", ORG_ID);
    await runtime.runSettingsChanged("s1", ORG_ID, { model: "m2" });

    expect(runtime.peek("s1")).toBeUndefined();
    await runtime.get("s1", ORG_ID);
    expect(builds).toHaveLength(2);
  });

  test("rebuilds a cognito chat with its history on a settings or revision change", async () => {
    const { builds, ended, runtime, setRevision } = setup();
    await runtime.openCognito(record("c1"), ORG_ID);

    const first = runtime.peek("c1");
    await first?.send("hi");
    const history = [...(first?.getHistory() ?? [])];

    expect(history.length).toBeGreaterThan(0);

    await runtime.runSettingsChanged("c1", ORG_ID, { thinkingEffort: "high" });
    setRevision("r2");
    await runtime.get("c1", ORG_ID);

    expect(builds.map((build) => build.context.kind)).toEqual([
      "cognito",
      "cognito",
      "cognito",
    ]);
    expect(builds[1]?.record.thinkingEffort).toBe("high");
    expect(runtime.cognitoRecord("c1")?.thinkingEffort).toBe("high");
    expect(runtime.peek("c1")).not.toBe(first);
    expect(runtime.peek("c1")?.getHistory()).toEqual(history);

    await runtime.end("c1");
    expect(ended).toEqual(["c1"]);
    expect(runtime.isCognito("c1")).toBe(false);
  });

  test("keeps cognito chats on invalidateAll unless asked", async () => {
    const { rows, runtime } = setup();
    rows.set("s1", record("s1"));
    await runtime.get("s1", ORG_ID);
    await runtime.openCognito(record("c1"), ORG_ID);

    runtime.invalidateAll();
    expect(runtime.peek("s1")).toBeUndefined();
    expect(runtime.isCognito("c1")).toBe(true);

    runtime.invalidateAll({ cognito: true });
    expect(runtime.isCognito("c1")).toBe(false);
  });

  test("invalidates only the chats of one profile", async () => {
    const { rows, runtime } = setup();
    rows.set("a", record("a"));
    rows.set("b", record("b", { profileId: "profile_other" }));
    await runtime.get("a", ORG_ID);
    await runtime.get("b", ORG_ID);

    runtime.invalidateProfile("profile_default");

    expect(runtime.peek("a")).toBeUndefined();
    expect(runtime.peek("b")).toBeDefined();
  });
});

describe("sessionKind", () => {
  test("tells a branch from a child chat", () => {
    expect(sessionKind({ parentSessionId: null })).toBe("chat");
    expect(sessionKind({ parentSessionId: "p" })).toBe("child");
    expect(
      sessionKind({ branchMessageIndex: undefined, parentSessionId: "p" })
    ).toBe("child");
    expect(sessionKind({ branchMessageIndex: 0, parentSessionId: "p" })).toBe(
      "branch"
    );
  });
});
