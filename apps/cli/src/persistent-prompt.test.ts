import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { PromptSuggestion } from "./commands";
import { PersistentPrompt } from "./persistent-prompt";
import type { PromptLineResult } from "./prompt";
import type { TerminalInput } from "./terminal-input";
import type { ComposerRenderer, ComposerState } from "./terminal-renderer";

class FakeRenderer implements ComposerRenderer {
  state: ComposerState | null = null;

  setComposerState(state: ComposerState): void {
    this.state = state;
  }
}

class FakeTerminalInput {
  onInput(): () => void {
    return () => {};
  }
}

describe("PersistentPrompt", () => {
  const prompts: PersistentPrompt[] = [];
  let stdoutWriteSpy: ReturnType<
    typeof spyOn<typeof process.stdout, "write">
  > | null = null;

  afterEach(() => {
    for (const prompt of prompts) {
      prompt.stop();
    }

    prompts.length = 0;
    stdoutWriteSpy?.mockRestore();
    stdoutWriteSpy = null;
  });

  test("prefill renders suggestions for the inserted value", () => {
    stdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true
    );
    const renderer = new FakeRenderer();
    const suggestions: PromptSuggestion[] = [
      {
        description: "Claude Sonnet [Anthropic]",
        insertValue: "/model provider-a::claude-sonnet",
        label: "claude-sonnet",
      },
    ];
    const prompt = new PersistentPrompt({
      getSuggestions: (input) => (input === "/model " ? suggestions : []),
      onCancel: () => {},
      onSubmit: (_result: PromptLineResult) => {},
      renderer,
      terminalInput: new FakeTerminalInput() as unknown as TerminalInput,
    });

    prompts.push(prompt);
    prompt.start();
    prompt.prefill("/model ");

    expect(renderer.state).toEqual({
      cursorVisible: true,
      prefix: "> ",
      selectedIndex: 0,
      suggestions: [
        {
          description: "Claude Sonnet [Anthropic]",
          label: "claude-sonnet",
        },
      ],
      value: "/model ",
    });
  });
});
