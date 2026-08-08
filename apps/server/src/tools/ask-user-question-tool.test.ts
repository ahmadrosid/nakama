import { expect, test } from "bun:test";
import { toLlmToolDefinition } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { estimateToolToken } from "../providers/usage-tracking";
import { AgentQuestionnaireState } from "../services/agent-questionnaire-state";
import { createAskUserQuestionTools } from "./ask-user-question-tool";

async function createTool() {
  const db = createInMemoryDatabaseAdapter();
  const state = new AgentQuestionnaireState(db);

  await db.upsertSession({
    agentQuestionnaire: null,
    agentTodos: [],
    channel: "web",
    createdAt: new Date().toISOString(),
    id: "session_test",
    profileId: "default",
    title: null,
  });

  const tool = createAskUserQuestionTools(state).find(
    (entry) => entry.name === "ask_user_question"
  );
  return { state, tool: tool! };
}

test("ask_user_question requires sessionId", async () => {
  const { tool } = await createTool();

  await expect(
    tool.run({ questions: [], title: "Need input" }, {})
  ).rejects.toThrow("requires an active chat session");
});

test("ask_user_question stores the questionnaire with generated ids", async () => {
  const { tool, state } = await createTool();

  const result = await tool.run(
    {
      questions: [
        {
          allowCustomAnswer: true,
          choices: ["Pacific Time", "Eastern Time"],
          prompt: "What timezone?",
        },
      ],
      title: "Need input",
    },
    { sessionId: "session_test" }
  );

  const stored = await state.get("session_test");
  expect(result).toEqual({ questionnaire: stored });
  expect(stored?.questions).toEqual([
    {
      allowCustomAnswer: true,
      choices: [
        { id: "pacific-time", label: "Pacific Time" },
        { id: "eastern-time", label: "Eastern Time" },
      ],
      id: "what-timezone",
      prompt: "What timezone?",
    },
  ]);
});

test("ask_user_question accepts legacy choice objects", async () => {
  const { tool, state } = await createTool();

  await tool.run(
    {
      questions: [
        {
          allowCustomAnswer: true,
          choices: [{ id: "pst", label: "Pacific Time" }],
          id: "timezone",
          prompt: "What timezone?",
        },
      ],
      title: "Need input",
    },
    { sessionId: "session_test" }
  );

  const stored = await state.get("session_test");
  expect(stored?.questions[0]).toMatchObject({
    allowCustomAnswer: true,
    choices: [{ id: "pst", label: "Pacific Time" }],
    id: "timezone",
    prompt: "What timezone?",
  });
});

test("ask_user_question schema stays compact", async () => {
  const { tool } = await createTool();
  const estimate = estimateToolToken(toLlmToolDefinition(tool));

  expect(estimate.tokens).toBeLessThan(140);
  expect(estimate.parametersChars).toBeLessThan(400);
});
