import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { usePromptInputController } from "@/components/ai-elements/prompt-input-context";
import { ChatStarterPrompts, STARTER_PROMPTS } from "./chat-starter-prompts";

let container: HTMLDivElement;

let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

function ComposerValue() {
  const { textInput } = usePromptInputController();

  return <output>{textInput.value}</output>;
}

test("a starter prompt fills the composer and hides the starters", async () => {
  await act(async () =>
    root.render(
      <PromptInputProvider>
        <ChatStarterPrompts />
        <ComposerValue />
      </PromptInputProvider>
    )
  );

  const buttons = [...container.querySelectorAll("button")];

  expect(buttons.map((button) => button.textContent)).toEqual(STARTER_PROMPTS);

  await act(async () => buttons[1]?.click());

  expect(container.querySelector("output")?.textContent).toBe(
    STARTER_PROMPTS[1]
  );
  expect(container.querySelectorAll("button")).toHaveLength(0);
});
