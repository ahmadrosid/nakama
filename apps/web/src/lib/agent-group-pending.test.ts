import { describe, expect, test } from "bun:test";
import type { AgentGroupSessionDetail } from "@nakama/core/agent-groups";
import {
  PENDING_RUN,
  sharedFileMentions,
  shortenSharedPaths,
  withPanel,
  withPendingMessage,
} from "./agent-group-pending";

describe("shared file mentions", () => {
  const full =
    "/Users/me/.nakama/orgs/org_1/groups/0cee5bc1-efcf/shared/launch-plan.md";

  test("a full path reads as shared/…", () => {
    expect(shortenSharedPaths(`plan is at ${full}.`)).toBe(
      "plan is at shared/launch-plan.md."
    );
  });

  test("full and short paths name files relative to the folder, once each", () => {
    expect(
      sharedFileMentions(
        `see ${full}, and \`shared/notes/draft-v2.md\` plus shared/notes/a.md. again shared/launch-plan.md`
      )
    ).toEqual(["launch-plan.md", "notes/draft-v2.md", "notes/a.md"]);
  });

  test("a folder or a word ending in shared is not a file", () => {
    expect(sharedFileMentions("overshared/x.md and shared/notes/")).toEqual([]);
  });

  test("opening a file closes the other panels", () => {
    const next = withPanel(
      new URLSearchParams("thread=4&memory=1&x=y"),
      "files",
      "notes/a.md"
    );

    expect(next.toString()).toBe("x=y&files=notes%2Fa.md");
  });
});

const idle: AgentGroupSessionDetail = {
  group: {
    avatarVersion: null,
    brief: "",
    createdAt: "",
    id: "g",
    lastMessage: null,
    memberIds: ["a", "b"],
    name: "Team",
  },
  messages: [
    {
      authorProfileId: "a",
      content: "hi",
      createdAt: "",
      id: 4,
      threadReplies: 0,
    },
  ],
  run: null,
  session: {
    active: false,
    createdAt: "",
    groupId: "g",
    id: "s",
    pinned: false,
    title: "hi",
    updatedAt: "",
  },
  threadRunIds: [],
};

describe("withPendingMessage", () => {
  test("appends the user's message and shows agents replying", () => {
    const next = withPendingMessage(idle, "@alpha go");

    expect(next.messages.at(-1)).toMatchObject({
      authorProfileId: null,
      content: "@alpha go",
    });
    expect(next.messages.at(-1)?.id).toBeLessThan(0);
    expect(next.run).toEqual(PENDING_RUN);
  });

  test("keeps a run that is already going", () => {
    const busy = {
      ...idle,
      run: { activity: "Searching", speakerProfileId: "a", stopping: false },
    };

    expect(withPendingMessage(busy, "more").run).toBe(busy.run);
  });
});
