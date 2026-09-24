import { describe, expect, test } from "bun:test";
import { createAgentChatSession } from "./index";
import { expandLearnInLastUserMessage } from "./learn-prompt";
import { createCapturingProvider } from "./test-helpers";

describe("/learn provider expansion", () => {
  test("sends expanded /learn to the provider while history stays raw", async () => {
    const provider = createCapturingProvider({
      assistantMessage: { content: "Saved.", role: "assistant" },
      content: "Saved.",
      toolCalls: [],
    });

    const session = createAgentChatSession(
      { provider },
      {
        rehydrateMessagesForProvider: (messages) =>
          Promise.resolve(expandLearnInLastUserMessage([...messages])),
      }
    );

    const typed = "/learn filing an expense";
    await session.send(typed);

    expect(session.getHistory().at(0)?.content).toBe(typed);

    const providerUser = provider.lastInput?.messages.find(
      (message) => message.role === "user"
    );
    expect(typeof providerUser?.content).toBe("string");
    expect(providerUser?.content).toContain("[/learn]");
    expect(providerUser?.content).toContain("filing an expense");
    expect(providerUser?.content).not.toBe(typed);
  });
});
