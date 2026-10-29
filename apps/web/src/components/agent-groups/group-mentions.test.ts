import { describe, expect, test } from "bun:test";
import type { ProfileSummary } from "@nakama/core";
import { groupRoster } from "@nakama/core/agent-groups";
import { markMentions } from "./group-mentions";

// SAFETY: mentions read only a profile's id and name.
const roster = groupRoster({ handles: {}, memberIds: ["p1", "p2"] }, [
  { id: "p1", name: "Eksis" },
  { id: "p2", name: "Eksis Explore News" },
] as ProfileSummary[]);

describe("markMentions", () => {
  test("marks mentions in prose and leaves code alone", () => {
    expect(
      markMentions(
        "Ask @eksis-explore-news, run `@eksis now`\n```\n@eksis\n```\nthanks @Eksis",
        roster
      )
    ).toBe(
      "Ask ~~@eksis-explore-news~~, run `@eksis now`\n```\n@eksis\n```\nthanks ~~@eksis~~"
    );
  });
});
