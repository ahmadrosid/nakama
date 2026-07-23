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
    id: "session_test",
    profileId: "default",
    channel: "web",
    createdAt: new Date().toISOString(),
    title: null,
    agentTodos: [],
    agentQuestionnaire: null,
  });

  const tool = createAskUserQuestionTools(state).find(
    (entry) => entry.name === "ask_user_question",
  );
  return { tool: tool!, state };
}

test("ask_user_question requires sessionId", async () => {
  const { tool } = await createTool();

  await expect(
    tool.run({ title: "Need input", questions: [] }, {}),
  ).rejects.toThrow("requires an active chat session");
});

test("ask_user_question stores the questionnaire with generated ids", async () => {
  const { tool, state } = await createTool();

  const result = await tool.run(
    {
      title: "Need input",
      questions: [
        {
          prompt: "What timezone?",
          choices: ["Pacific Time", "Eastern Time"],
          allowCustomAnswer: true,
        },
      ],
    },
    { sessionId: "session_test" },
  );

  const stored = await state.get("session_test");
  expect(result).toEqual({ questionnaire: stored });
  expect(stored?.questions).toEqual([
    {
      id: "what-timezone",
      prompt: "What timezone?",
      allowCustomAnswer: true,
      choices: [
        { id: "pacific-time", label: "Pacific Time" },
        { id: "eastern-time", label: "Eastern Time" },
      ],
    },
  ]);
});

test("ask_user_question accepts legacy choice objects", async () => {
  const { tool, state } = await createTool();

  await tool.run(
    {
      title: "Need input",
      questions: [
        {
          id: "timezone",
          prompt: "What timezone?",
          allowCustomAnswer: true,
          choices: [{ id: "pst", label: "Pacific Time" }],
        },
      ],
    },
    { sessionId: "session_test" },
  );

  const stored = await state.get("session_test");
  expect(stored?.questions[0]).toMatchObject({
    id: "timezone",
    prompt: "What timezone?",
    allowCustomAnswer: true,
    choices: [{ id: "pst", label: "Pacific Time" }],
  });
});

test("ask_user_question schema stays compact", async () => {
  const { tool } = await createTool();
  const estimate = estimateToolToken(toLlmToolDefinition(tool));

  expect(estimate.tokens).toBeLessThan(140);
  expect(estimate.parametersChars).toBeLessThan(400);
});
