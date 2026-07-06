import { expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentQuestionnaireState } from "./agent-questionnaire-state";

async function createState() {
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

  return { db, state };
}

test("write persists a questionnaire", async () => {
  const { state, db } = await createState();

  const questionnaire = await state.write("session_test", {
    id: "q_1",
    title: "Need input",
    questions: [
      {
        id: "role",
        prompt: "Role?",
        allowCustomAnswer: true,
        choices: [{ id: "eng", label: "Engineer" }],
      },
    ],
  });

  expect(questionnaire.title).toBe("Need input");
  expect(await db.getSessionQuestionnaire("session_test")).toEqual(questionnaire);
});

test("clear removes the questionnaire", async () => {
  const { state, db } = await createState();

  await state.write("session_test", {
    id: "q_1",
    title: "Need input",
    questions: [
      {
        id: "role",
        prompt: "Role?",
        allowCustomAnswer: true,
        choices: [],
      },
    ],
  });

  await state.clear("session_test");

  expect(await state.get("session_test")).toBeNull();
  expect(await db.getSessionQuestionnaire("session_test")).toBeNull();
});
