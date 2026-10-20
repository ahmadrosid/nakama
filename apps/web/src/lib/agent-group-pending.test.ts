import { describe, expect, test } from "bun:test";
import type { AgentGroupSessionDetail } from "@nakama/core/agent-groups";
import { PENDING_RUN, withPendingMessage } from "./agent-group-pending";

const idle: AgentGroupSessionDetail = {
  group: {
    avatarVersion: null,
    createdAt: "",
    id: "g",
    memberIds: ["a", "b"],
    name: "Team",
  },
  messages: [{ authorProfileId: "a", content: "hi", createdAt: "", id: 4 }],
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
