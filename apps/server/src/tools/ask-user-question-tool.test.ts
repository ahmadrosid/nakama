import { expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
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

test("ask_user_question stores the questionnaire", async () => {
  const { tool, state } = await createTool();

  const result = await tool.run(
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

  expect(result).toEqual({
    questionnaire: await state.get("session_test"),
  });
});
