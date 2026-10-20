import { afterEach, describe, expect, test } from "bun:test";
import type { ProfileSummary } from "@nakama/core";
import { setupTestConfigDir } from "../test-config-dir";
import type { SubAgentRunInput } from "../tools/sub-agent-shared";
import { AgentGroupService, readGroupDocuments } from "./agent-group-service";
import { closeAgentGroupDatabases } from "./agent-group-store";

const ORG_ID = "org_test";

const USER_ID = "u1";

// Before the config dir cleanup, which Windows refuses while a file is open.
afterEach(closeAgentGroupDatabases);

setupTestConfigDir("nakama-agent-group-service-");

function setup(reply: (input: SubAgentRunInput) => string | Promise<string>) {
  // SAFETY: The service reads only these ProfileSummary fields.
  const profiles = [
    { id: "a", isSuper: false, name: "Alpha", sharedWithTeam: true },
    { id: "b", isSuper: false, name: "Beta", sharedWithTeam: true },
    {
      id: "s",
      isSuper: false,
      name: "Secret",
      ownerUserId: "u2",
      sharedWithTeam: false,
    },
  ] as ProfileSummary[];

  const state = { inOrg: true };
  const calls: string[] = [];

  // SAFETY: Tests implement only the two lookups the service reads.
  const db = {
    getOrgMember: async () => (state.inOrg ? { role: "member" } : null),
    getUserById: async () => ({ id: USER_ID }),
  } as never;

  // SAFETY: Tests implement only listProfiles and runSubAgentPrompt.
  const agent = {
    listProfiles: async () => ({ profiles }),
    runSubAgentPrompt: async (input: SubAgentRunInput) => {
      calls.push(input.profileId);
      const output = await reply(input);

      return { output, status: "success", summary: output };
    },
  } as never;

  const service = new AgentGroupService(db, agent);

  /** Opens a session with `content` and waits for the replies. */
  async function chat(groupId: string, content: string) {
    const { run, session } = service.start(ORG_ID, USER_ID, groupId, content);
    await run;

    return session.id;
  }

  function contents(groupId: string, sessionId: string) {
    return service
      .session(ORG_ID, USER_ID, groupId, sessionId)
      .messages.map((message) => message.content);
  }

  return { calls, chat, contents, profiles, service, state };
}

describe("AgentGroupService", () => {
  test("rejects an agent the user cannot chat with", async () => {
    const { service } = setup(() => "");

    await expect(
      service.create(ORG_ID, USER_ID, "Team", ["a", "s"])
    ).rejects.toMatchObject({ status: 403 });
  });

  test("an edit keeps a member who lost access but cannot add one", async () => {
    const { profiles, service } = setup(() => "");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    Object.assign(profiles[1]!, { ownerUserId: "u2", sharedWithTeam: false });

    await expect(
      service.update(ORG_ID, USER_ID, group.id, "Crew", ["b", "a"])
    ).resolves.toMatchObject({ memberIds: ["b", "a"], name: "Crew" });
    await expect(
      service.update(ORG_ID, USER_ID, group.id, "Crew", ["a", "b", "s"])
    ).rejects.toMatchObject({ status: 403 });
  });

  test("a mentioned agent hands off and the run ends when nobody is mentioned", async () => {
    const { calls, chat, contents, service } = setup(({ profileId }) =>
      profileId === "a" ? "over to @beta" : "done"
    );

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "@alpha start");

    expect(calls).toEqual(["a", "b"]);
    expect(contents(group.id, sessionId)).toEqual([
      "@alpha start",
      "over to @beta",
      "done",
    ]);
    expect(service.sessions(ORG_ID, USER_ID, group.id)).toMatchObject([
      { active: false, id: sessionId, title: "@alpha start" },
    ]);
  });

  test("@all gives every member a turn, in member order", async () => {
    const { calls, chat, service } = setup(() => "here");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["b", "a"]);

    await chat(group.id, "@all status?");

    expect(calls).toEqual(["b", "a"]);
  });

  test("two agents mentioning each other stop at the hop cap", async () => {
    const { calls, chat, service } = setup(({ profileId }) =>
      profileId === "a" ? "@beta" : "@alpha"
    );

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    await chat(group.id, "@alpha go");

    expect(calls).toHaveLength(6);
  });

  test("every agent gets the group brief as context", async () => {
    const tasks: string[] = [];

    const { chat, service } = setup(({ task }) => {
      tasks.push(task);

      return "ok";
    });

    const group = await service.create(
      ORG_ID,
      USER_ID,
      "Team",
      ["a", "b"],
      "Launch v2 on Friday"
    );

    await chat(group.id, "@all hi");

    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.includes("Launch v2 on Friday"))).toBe(
      true
    );
  });

  test("an attached document reaches the agent, and the client sees only its name", async () => {
    const contexts: string[] = [];

    const { service } = setup(({ context }) => {
      contexts.push(context ?? "");

      return "ok";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    const documents = await readGroupDocuments([
      {
        data: Buffer.from("Q3 revenue was 42").toString("base64"),
        filename: "notes.txt",
        mediaType: "text/plain",
      },
    ]);

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "",
      documents
    );

    await run;

    expect(contexts[0]).toContain("Q3 revenue was 42");

    const [message] = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      session.id
    ).messages;

    expect(message?.files).toEqual(["notes.txt"]);
    expect(JSON.stringify(message)).not.toContain("Q3 revenue");
  });

  test("a document of an unsupported type is rejected", async () => {
    await expect(
      readGroupDocuments([
        {
          data: "AAAA",
          filename: "run.exe",
          mediaType: "application/x-msdownload",
        },
      ])
    ).rejects.toThrow();
  });

  test("without a mention the session's last speaker replies, else the first member", async () => {
    const { calls, chat, service } = setup(() => "ok");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "hello");

    await service.post(ORG_ID, USER_ID, group.id, sessionId, "@beta hi");
    await service.post(ORG_ID, USER_ID, group.id, sessionId, "and you?");
    // A new session has no last speaker of its own.
    await chat(group.id, "fresh start");

    expect(calls).toEqual(["a", "b", "b", "a"]);
  });

  test("an agent that loses access mid-run is skipped", async () => {
    const { calls, chat, profiles, service } = setup(() => {
      Object.assign(profiles[1]!, { ownerUserId: "u2", sharedWithTeam: false });

      return "@beta your turn";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "@alpha go");

    expect(calls).toEqual(["a"]);
    expect(
      service.session(ORG_ID, USER_ID, group.id, sessionId).messages.at(-1)
    ).toMatchObject({ authorProfileId: "b", content: "_Skipped: no access_" });
  });

  test("a user who left the org gets no replies", async () => {
    const { calls, chat, service, state } = setup(() => "ok");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    state.inOrg = false;

    await chat(group.id, "@alpha hi");

    expect(calls).toEqual([]);
  });

  test("stop ends the run after the current hop", async () => {
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();

    const { calls, service } = setup(async () => {
      started.resolve();
      await held.promise;

      return "@beta next";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "@alpha go"
    );

    await started.promise;
    expect(service.sessions(ORG_ID, USER_ID, group.id)[0]?.active).toBe(true);
    service.stop(ORG_ID, USER_ID, group.id, session.id);
    held.resolve();
    await run;

    expect(calls).toEqual(["a"]);
    expect(
      service.session(ORG_ID, USER_ID, group.id, session.id).run
    ).toBeNull();
  });

  test("a running turn exposes the agent's steps and text so far", async () => {
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();

    const { service } = setup(async (input) => {
      input.onActivity?.("Searching the web");
      input.onText?.("Hel");
      input.onText?.("lo");
      started.resolve();
      await held.promise;

      return "Hello";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a"]);

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "@alpha hi"
    );

    await started.promise;

    expect(service.session(ORG_ID, USER_ID, group.id, session.id).run).toEqual(
      expect.objectContaining({
        speakerProfileId: "a",
        steps: ["Searching the web"],
        text: "Hello",
      })
    );
    held.resolve();
    await run;
  });

  test("a message after Stop only wakes the agents it mentions", async () => {
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();

    const { calls, service } = setup(async () => {
      started.resolve();
      await held.promise;

      return "noted";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "@alpha @beta go"
    );

    await started.promise;
    service.stop(ORG_ID, USER_ID, group.id, session.id);
    await service.post(ORG_ID, USER_ID, group.id, session.id, "@alpha again");
    held.resolve();
    await run;

    // Beta was queued before Stop, so it must not reply.
    expect(calls).toEqual(["a", "a"]);
  });

  test("a message sent while agents reply joins the running turn", async () => {
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();

    const { calls, contents, service } = setup(async ({ profileId }) => {
      if (profileId === "a") {
        started.resolve();
        await held.promise;
      }

      return "noted";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "@alpha go"
    );

    await started.promise;
    await service.post(ORG_ID, USER_ID, group.id, session.id, "@beta you too");
    held.resolve();
    await run;

    expect(calls).toEqual(["a", "b"]);
    expect(contents(group.id, session.id)).toEqual([
      "@alpha go",
      "@beta you too",
      "noted",
      "noted",
    ]);
  });

  test("deleting a session mid-run ends that run", async () => {
    const started = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();

    const { calls, service } = setup(async () => {
      started.resolve();
      await held.promise;

      return "@beta next";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "@alpha go"
    );

    await started.promise;
    service.deleteSession(ORG_ID, USER_ID, group.id, session.id);
    held.resolve();
    await run.catch(() => undefined);

    expect(calls).toEqual(["a"]);
    expect(service.sessions(ORG_ID, USER_ID, group.id)).toEqual([]);
  });

  test("a thread is answered by the agent it hangs from, and stays out of the main chat", async () => {
    const { calls, chat, contents, service } = setup(({ profileId, task }) =>
      task.includes("private thread") ? "thread answer" : `${profileId} spoke`
    );

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "@beta hello");

    const [, root] = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId
    ).messages;

    calls.length = 0;
    await service.postThread(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId,
      root!.id,
      "more?"
    );

    expect(calls).toEqual(["b"]);
    expect(contents(group.id, sessionId)).toEqual(["@beta hello", "b spoke"]);

    const thread = service.thread(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId,
      root!.id
    );

    expect(thread.profileId).toBe("b");
    expect(thread.messages.map((message) => message.content)).toEqual([
      "b spoke",
      "more?",
      "thread answer",
    ]);
    expect(
      service.session(ORG_ID, USER_ID, group.id, sessionId).messages[1]
    ).toMatchObject({ threadReplies: 2 });
  });

  test("a thread cannot open on the user's own message", async () => {
    const { chat, service } = setup(() => "ok");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "@alpha hi");

    const [own] = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId
    ).messages;

    expect(() =>
      service.thread(ORG_ID, USER_ID, group.id, sessionId, own!.id)
    ).toThrow(expect.objectContaining({ status: 404 }));
  });
});
