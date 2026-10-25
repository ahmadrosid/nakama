import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AgentQuestionnairePanel } from "@/components/chat/AgentQuestionnairePanel";

test("the recommended choice carries a Recommended badge", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <AgentQuestionnairePanel
        onSubmit={() => undefined}
        questionnaire={{
          id: "q",
          questions: [
            {
              allowCustomAnswer: false,
              choices: [
                { id: "d1", label: "D1", recommended: true },
                { id: "kv", label: "KV" },
              ],
              id: "db",
              prompt: "Which database?",
            },
          ],
          title: "Need input",
        }}
      />
    );
  });

  const options = [
    ...container.querySelectorAll("button[data-question-option='true']"),
  ].map((option) => option.textContent);

  expect(options).toEqual(["1.D1Recommended", "2.KV"]);

  act(() => root.unmount());
});
