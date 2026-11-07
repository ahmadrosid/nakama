import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getProfileSoulDir, SOUL_TEMPLATE } from "@nakama/core";
import { groupRoster } from "@nakama/core/agent-groups";
import { setupTestConfigDir } from "../test-config-dir";
import { groupMemoryTool } from "../tools/group-memory-tool";
import {
  appendAgentGroupMessage,
  closeAgentGroupDatabases,
  createAgentGroup,
} from "./agent-group-store";
import { ORG_ID, setup, USER_ID } from "./agent-group-test-setup";
import { threadTranscript, transcript } from "./agent-group-turn";
import { GROUP_MEMORY_CHARS, groupWorkspace } from "./agent-group-workspace";

// Before the config dir cleanup, which Windows refuses while a file is open.
afterEach(closeAgentGroupDatabases);

setupTestConfigDir("nakama-agent-group-service-");

/** Writes the whole memory, as the user's editor would. */
function seedMemory(sharedDir: string, content: string) {
  const { memory } = groupWorkspace(sharedDir);
  memory.replace(content, memory.read());
}

describe("AgentGroupService", () => {
  test.each(["reply", "pass", "error"])(
    "keeps ordered memory changes after %s, including thread replies and reload",
    async (outcome) => {
      const { chat, service } = setup(
        async ({ profileId, sharedDir, onGroupMemoryChange }) => {
          if (profileId === "a") {
            return "Answer";
          }

          for (const input of [
            { entry: "Yearly is $39.99" },
            { entry: "Yearly is $49.99", replaces: "Yearly is $39.99" },
            { entry: "", replaces: "Yearly is $49.99" },
          ]) {
            const result = await groupMemoryTool.run(input, { sharedDir });

            if (result.change) {
              onGroupMemoryChange?.(result.change);
            }
          }

          if (outcome === "error") {
            throw new Error("Provider failed after writing");
          }

          return outcome === "pass" ? "(pass)" : "Done";
        }
      );

      const changes = [
        { newEntry: "- Yearly is $39.99", oldEntry: null },
        { newEntry: "- Yearly is $49.99", oldEntry: "- Yearly is $39.99" },
        { newEntry: null, oldEntry: "- Yearly is $49.99" },
      ];

      const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
      const sessionId = await chat(group.id, "hello");
      closeAgentGroupDatabases();

      const messages = service.session(
        ORG_ID,
        USER_ID,
        group.id,
        sessionId
      ).messages;

      expect(messages).toHaveLength(3);
      expect(messages[0]?.memoryChanges).toBeUndefined();
      expect(messages[1]?.memoryChanges).toBeUndefined();
      const reply = messages[2]!;
      expect(reply.authorProfileId).toBe("b");
      expect(reply.memoryChanges).toEqual(changes);

      if (outcome === "pass") {
        expect(reply.content).toBe("");
      }

      await service.postThread(
        ORG_ID,
        USER_ID,
        group.id,
        sessionId,
        reply.id,
        "continue"
      );
      closeAgentGroupDatabases();

      const thread = service.thread(
        ORG_ID,
        USER_ID,
        group.id,
        sessionId,
        reply.id
      );

      expect(thread.messages.at(-1)?.memoryChanges).toEqual(changes);
      expect(
        service.session(ORG_ID, USER_ID, group.id, sessionId).messages
      ).toHaveLength(3);
    }
  );

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

  test("the first reply gives a new session a generated title", async () => {
    const { chat, service, state } = setup(() => "ok");
    state.title = "Launch Plan";

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a"]);
    const sessionId = await chat(group.id, "plan the launch");

    expect(service.sessions(ORG_ID, USER_ID, group.id)).toMatchObject([
      { id: sessionId, title: "Launch Plan" },
    ]);

    state.title = "Other";
    await service.post(ORG_ID, USER_ID, group.id, sessionId, "more");

    expect(service.sessions(ORG_ID, USER_ID, group.id)).toMatchObject([
      { id: sessionId, title: "Launch Plan" },
    ]);
  });

  test("a title the user set before the first reply stays", async () => {
    const { service, state } = setup(async () => {
      service.updateSession(ORG_ID, USER_ID, group.id, session.id, {
        title: "Mine",
      });

      return "ok";
    });

    state.title = "Generated";

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a"]);
    const { run, session } = service.start(ORG_ID, USER_ID, group.id, "hi");
    await run;

    expect(service.sessions(ORG_ID, USER_ID, group.id)).toMatchObject([
      { id: session.id, title: "Mine" },
    ]);
  });

  test("every member of a group gets the same shared folder", async () => {
    const dirs: Array<string | undefined> = [];

    const { chat, service } = setup((input) => {
      dirs.push(input.sharedDir);

      return "ok";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const other = await service.create(ORG_ID, USER_ID, "Other", ["a", "b"]);

    await chat(group.id, "@all hi");
    await chat(other.id, "@alpha hi");

    expect(dirs[0]).toBe(dirs[1]);
    expect(dirs[0]).toContain(group.id);
    expect(dirs[2]).toContain(other.id);
    expect(dirs[2]).not.toBe(dirs[0]);
  });

  test("a fact saved in one chat reaches every member in the next, and threads", async () => {
    const tasks: string[] = [];

    const { chat, contents, service } = setup(async ({ sharedDir, task }) => {
      tasks.push(task);

      if (tasks.length === 1) {
        await groupMemoryTool.run({ entry: "noir" }, { sharedDir });
      }

      return "ok";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    await chat(group.id, "@alpha the genre is noir");
    const sessionId = await chat(group.id, "@all hi");

    const root = service.session(ORG_ID, USER_ID, group.id, sessionId)
      .messages[1];

    await service.postThread(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId,
      root!.id,
      "and?"
    );

    expect(contents(group.id, sessionId)).toHaveLength(3);
    expect(tasks).toHaveLength(4);

    for (const task of tasks.slice(1)) {
      expect(task.split("\n")).toContain("- noir");
    }
  });

  test("memory past the cap reaches agents cut, not as an error", async () => {
    const tasks: string[] = [];

    const { chat, service } = setup(({ sharedDir, task }) => {
      tasks.push(task);
      seedMemory(sharedDir!, `- ${"a".repeat(GROUP_MEMORY_CHARS)}-tail`);

      return "ok";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    await chat(group.id, "@alpha hi");
    await chat(group.id, "@alpha again");

    expect(tasks[1]).toContain("[truncated]");
    expect(tasks[1]).not.toContain("-tail");
  });

  test("memory past the cap is cut at the last full line", async () => {
    const tasks: string[] = [];
    const first = `- ${"a".repeat(GROUP_MEMORY_CHARS - 100)}`;

    const { chat, service } = setup(({ sharedDir, task }) => {
      tasks.push(task);
      seedMemory(sharedDir!, `${first}\n- ${"b".repeat(200)}`);

      return "ok";
    });

    // The same letters outside memory must not look like a leaked entry.
    const group = await service.create(ORG_ID, USER_ID, "Team bbb", ["a", "b"]);

    await chat(group.id, "@alpha hi");
    await chat(group.id, "@alpha again");

    const lines = tasks[1]!.split("\n");

    expect(lines).toContain(first);
    expect(lines[lines.indexOf(first) + 1]).toBe("[truncated]");
    expect(lines).not.toContain(`- ${"b".repeat(200)}`);
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

  test("the roster gives each teammate's SOUL.md tagline, but not the template's", async () => {
    await Bun.write(
      join(getProfileSoulDir(ORG_ID, "a"), "SOUL.md"),
      "# Alpha\n\nWrites and reviews\n**copy**.\n\n---\n\n## Who I Am"
    );
    await Bun.write(
      join(getProfileSoulDir(ORG_ID, "b"), "SOUL.md"),
      SOUL_TEMPLATE
    );

    const tasks: string[] = [];

    const { chat, service } = setup(({ task }) => {
      tasks.push(task);

      return "ok";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    await chat(group.id, "@alpha hi");

    const roster = tasks[0]
      ?.split("\n")
      .filter((line) => line.startsWith("- @"));

    expect(roster).toEqual([
      "- @alpha (you): Writes and reviews copy.",
      "- @beta",
    ]);
  });

  test("without a mention the last speaker answers first, then the others may pass", async () => {
    // Every agent passes whenever its task allows it.
    const { calls, chat, contents, service } = setup(({ task }) =>
      task.includes("(pass)") ? "(pass)" : "ok"
    );

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "hello");

    await service.post(ORG_ID, USER_ID, group.id, sessionId, "@beta hi");
    await service.post(ORG_ID, USER_ID, group.id, sessionId, "and you?");
    // A new session has no last speaker of its own.
    await chat(group.id, "fresh start");

    expect(calls).toEqual(["a", "b", "b", "b", "a", "a", "b"]);
    expect(contents(group.id, sessionId)).toEqual([
      "hello",
      "ok",
      "@beta hi",
      "ok",
      "and you?",
      "ok",
    ]);
  });

  test("a memory-only pass does not become the last speaker", async () => {
    const { calls, chat, service } = setup(
      async ({ sharedDir, onGroupMemoryChange, task }) => {
        if (!task.includes("(pass)")) {
          return "Answer";
        }

        const result = await groupMemoryTool.run(
          { entry: "Yearly is $39.99" },
          { sharedDir }
        );

        if (result.change) {
          onGroupMemoryChange?.(result.change);
        }

        return "(pass)";
      }
    );

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "hello");
    closeAgentGroupDatabases();
    await service.post(ORG_ID, USER_ID, group.id, sessionId, "and you?");

    expect(calls).toEqual(["a", "b", "a", "b"]);
    expect(
      service.session(ORG_ID, USER_ID, group.id, sessionId).messages[2]
    ).toMatchObject({
      authorProfileId: "b",
      content: "",
      memoryChanges: [{ newEntry: "- Yearly is $39.99", oldEntry: null }],
    });
  });

  test("a memory-only pass cannot answer a message sent during that turn", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let held = false;

    const { service } = setup(
      async ({ profileId, task, sharedDir, onGroupMemoryChange }) => {
        if (profileId === "b" && !held) {
          held = true;
          started.resolve();
          await release.promise;

          const result = await groupMemoryTool.run(
            { entry: "Yearly is $39.99" },
            { sharedDir }
          );

          if (result.change) {
            onGroupMemoryChange?.(result.change);
          }
        }

        return task.includes("(pass)") ? "(pass)" : "Answer";
      }
    );

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const { run, session } = service.start(ORG_ID, USER_ID, group.id, "hello");
    await started.promise;
    await service.post(ORG_ID, USER_ID, group.id, session.id, "new question");
    release.resolve();
    await run;

    const messages = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      session.id
    ).messages;

    const replies = messages.slice(
      messages.findLastIndex((message) => message.authorProfileId === null) + 1
    );

    expect(replies).toMatchObject([
      {
        authorProfileId: "b",
        content: "",
        memoryChanges: [{ newEntry: "- Yearly is $39.99", oldEntry: null }],
      },
      { authorProfileId: "a", content: "Answer" },
    ]);
  });

  test("memory-only notices do not consume main or thread context limits", async () => {
    const { chat, profiles, service } = setup(() => "Answer");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "@alpha hello");

    const { session } = service.session(ORG_ID, USER_ID, group.id, sessionId);

    let rootId = 0;

    // 41 spoken messages: the oldest must fall out, but notices must not.
    for (let index = 0; index < 39; index++) {
      rootId = appendAgentGroupMessage(
        ORG_ID,
        session,
        index % 2 === 0 ? "a" : null,
        `History ${index}`
      ).id;
    }

    const roster = groupRoster(group, profiles);
    const mainBefore = transcript(ORG_ID, sessionId, roster);
    expect(mainBefore).not.toContain("@alpha hello");
    expect(mainBefore).toContain("Answer");

    const threadBefore = threadTranscript(ORG_ID, sessionId, rootId, roster);

    // More notices than the entire context window must still consume no slots.
    for (const threadRootId of [
      ...Array<undefined>(41).fill(undefined),
      rootId,
    ]) {
      appendAgentGroupMessage(
        ORG_ID,
        session,
        "b",
        "",
        threadRootId,
        [],
        [{ newEntry: "- Saved fact", oldEntry: null }]
      );
    }

    expect(transcript(ORG_ID, sessionId, roster)).toBe(mainBefore);
    expect(threadTranscript(ORG_ID, sessionId, rootId, roster)).toBe(
      threadBefore
    );
    expect(
      service.session(ORG_ID, USER_ID, group.id, sessionId).messages.at(-1)
        ?.memoryChanges
    ).toHaveLength(1);
    expect(
      service.session(ORG_ID, USER_ID, group.id, sessionId).messages
    ).toHaveLength(82);
  });

  test("a teammate's @mention cannot be passed on", async () => {
    const { chat, contents, service } = setup(({ profileId, task }) => {
      if (task.includes("(pass)")) {
        return "(pass)";
      }

      return profileId === "a" ? "ask @beta" : "on it";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "hello");

    expect(contents(group.id, sessionId)).toEqual([
      "hello",
      "ask @beta",
      "on it",
    ]);
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

  test("@alpha-2 keeps its agent after the first Alpha loses access", async () => {
    const tasks: string[] = [];

    const { calls, chat, profiles, service } = setup(({ task }) => {
      tasks.push(task);

      return "ok";
    });

    profiles.push({ ...profiles[0]!, id: "c" });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "c"]);
    Object.assign(profiles[0]!, { ownerUserId: "u2", sharedWithTeam: false });

    await chat(group.id, "@alpha-2 hi");

    expect(calls).toEqual(["c"]);
    expect(tasks[0]).toContain("(@alpha-2)");
  });

  test("a group saved without handles saves them on its first run", async () => {
    const { chat, service } = setup(() => "ok");
    const group = createAgentGroup(ORG_ID, USER_ID, "Team", ["b", "a"]);

    await chat(group.id, "hi");

    expect(service.get(ORG_ID, USER_ID, group.id).handles).toEqual({
      a: "alpha",
      b: "beta",
    });
  });

  test("an edit of a group saved without handles keeps its old ones", async () => {
    const { calls, chat, profiles, service } = setup(() => "ok");
    profiles.push({ ...profiles[0]!, id: "c" });
    const group = createAgentGroup(ORG_ID, USER_ID, "Team", ["a", "c"]);

    await service.update(ORG_ID, USER_ID, group.id, "Team", ["c"]);
    await chat(group.id, "@alpha-2 hi");

    expect(service.get(ORG_ID, USER_ID, group.id).handles).toEqual({
      a: "alpha",
      c: "alpha-2",
    });
    expect(calls).toEqual(["c"]);
  });

  test("a user who left the org gets no replies", async () => {
    const { calls, chat, service, state } = setup(() => "ok");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    state.inOrg = false;

    await chat(group.id, "@alpha hi");

    expect(calls).toEqual([]);
  });

  test("stop aborts the running reply and keeps what it wrote so far", async () => {
    const started = Promise.withResolvers<void>();

    const { calls, contents, service } = setup(async ({ onText, signal }) => {
      onText?.("half a thought");
      started.resolve();

      await new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason));
      });

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
    await run;

    expect(calls).toEqual(["a"]);
    expect(contents(group.id, session.id)).toEqual([
      "@alpha go",
      "half a thought",
    ]);
    expect(
      service.session(ORG_ID, USER_ID, group.id, session.id).run
    ).toBeNull();
  });

  test("a stopped turn keeps a memory write even when it wrote no text", async () => {
    const started = Promise.withResolvers<void>();

    const { service } = setup(
      async ({ onGroupMemoryChange, sharedDir, signal }) => {
        const result = await groupMemoryTool.run(
          { entry: "Genre is noir" },
          { sharedDir }
        );

        if (result.change) {
          onGroupMemoryChange?.(result.change);
        }

        started.resolve();

        await new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        });

        return "never";
      }
    );

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "@alpha go"
    );

    await started.promise;
    service.stop(ORG_ID, USER_ID, group.id, session.id);
    await run;

    const stopped = service
      .session(ORG_ID, USER_ID, group.id, session.id)
      .messages.at(-1);

    expect(stopped).toMatchObject({
      authorProfileId: "a",
      content: "",
      memoryChanges: [{ newEntry: "- Genre is noir", oldEntry: null }],
    });
  });

  test("a failed turn stores the same error in the main chat and in a thread", async () => {
    const state = { fail: false };

    const { chat, contents, service } = setup(() => {
      if (state.fail) {
        throw new Error("boom");
      }

      return "ok";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "@alpha hi");

    const [, root] = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId
    ).messages;

    state.fail = true;
    await service.post(ORG_ID, USER_ID, group.id, sessionId, "@alpha again");
    await service.postThread(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId,
      root!.id,
      "more?"
    );

    expect(contents(group.id, sessionId)).toEqual([
      "@alpha hi",
      "ok",
      "@alpha again",
      "_boom_",
    ]);
    expect(
      service
        .thread(ORG_ID, USER_ID, group.id, sessionId, root!.id)
        .messages.map((message) => message.content)
    ).toEqual(["ok", "more?", "_boom_"]);
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

  test("stop right after a thread message cancels the reply", async () => {
    const { calls, chat, service } = setup(() => "ok");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sessionId = await chat(group.id, "@alpha hi");

    const [, root] = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId
    ).messages;

    calls.length = 0;

    const run = service.postThread(
      ORG_ID,
      USER_ID,
      group.id,
      sessionId,
      root!.id,
      "more?"
    );

    service.stopThread(ORG_ID, USER_ID, group.id, sessionId, root!.id);
    await run;

    expect(calls).toEqual([]);
    expect(
      service
        .thread(ORG_ID, USER_ID, group.id, sessionId, root!.id)
        .messages.map((message) => message.content)
    ).toEqual(["ok", "more?"]);
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
