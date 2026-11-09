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

  expect(options).toEqual(["1D1Recommended", "2KV"]);

  act(() => root.unmount());
});

function typeInto(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;

  setValue?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function renderCustomQuestion() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const submitted: string[] = [];

  await act(async () => {
    root.render(
      <AgentQuestionnairePanel
        onSubmit={(answers) =>
          submitted.push(...answers.map((entry) => entry.answer))
        }
        questionnaire={{
          id: "q",
          questions: [
            {
              allowCustomAnswer: true,
              choices: [
                { id: "d1", label: "D1" },
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

  const option = () =>
    container.querySelector<HTMLButtonElement>(
      "button[data-question-option='true']"
    )!;

  const input = () => container.querySelector<HTMLInputElement>("input")!;

  const submit = () =>
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Submit"
    )!;

  return { container, input, option, root, submit, submitted };
}

test("typing a custom answer clears the picked option", async () => {
  const view = await renderCustomQuestion();

  await act(async () => view.option().click());
  await act(async () => typeInto(view.input(), "Postgres"));

  expect(view.option().dataset.selected).toBe("false");

  await act(async () => view.submit().click());

  expect(view.submitted).toEqual(["Postgres"]);

  act(() => view.root.unmount());
  view.container.remove();
});

test("picking an option clears the typed custom answer", async () => {
  const view = await renderCustomQuestion();

  await act(async () => typeInto(view.input(), "Postgres"));
  await act(async () => view.option().click());

  expect(view.input().value).toBe("");

  await act(async () => view.submit().click());

  expect(view.submitted).toEqual(["D1"]);

  act(() => view.root.unmount());
  view.container.remove();
});
