import { describe, expect, test } from "bun:test";
import { createAgentHarness } from "./index";

describe("initial chat history", () => {
  test("restores prior messages into the session", async () => {
    const harness = createAgentHarness();
    const session = harness.createChatSession({
      initialHistory: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    });

    expect(session.getHistory()).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
  });
});
