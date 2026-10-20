import { describe, expect, test } from "bun:test";
import { memberHandles } from "@nakama/core/agent-groups";
import { markMentions } from "./group-mentions";

const handles = memberHandles([
  { id: "p1", name: "Eksis" },
  { id: "p2", name: "Eksis Explore News" },
]);

describe("markMentions", () => {
  test("marks mentions in prose and leaves code alone", () => {
    expect(
      markMentions(
        "Ask @eksis-explore-news, run `@eksis now`\n```\n@eksis\n```\nthanks @Eksis",
        handles
      )
    ).toBe(
      "Ask ~~@eksis-explore-news~~, run `@eksis now`\n```\n@eksis\n```\nthanks ~~@eksis~~"
    );
  });
});
