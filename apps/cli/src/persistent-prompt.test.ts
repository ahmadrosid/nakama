import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { PromptSuggestion } from "./commands";
import {
  MAX_BRACKETED_PASTE_BYTES,
  PersistentPrompt,
} from "./persistent-prompt";
import type { PromptLineResult } from "./prompt";
import type { TerminalInput } from "./terminal-input";
import type { ComposerState, TerminalRenderer } from "./terminal-renderer";

class FakeRenderer implements Pick<TerminalRenderer, "setComposerState"> {
  state: ComposerState | null = null;

  setComposerState(state: ComposerState): void {
    this.state = state;
  }
}

class FakeTerminalInput {
  private listener: ((chunk: string) => void) | null = null;

  onInput(listener: (chunk: string) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(chunk: string): void {
    this.listener?.(chunk);
  }
}

describe("PersistentPrompt", () => {
  const prompts: PersistentPrompt[] = [];
  let stdoutWriteSpy: ReturnType<
    typeof spyOn<typeof process.stdout, "write">
  > | null = null;
  let stderrWriteSpy: ReturnType<
    typeof spyOn<typeof process.stderr, "write">
  > | null = null;

  afterEach(() => {
    for (const prompt of prompts) {
      prompt.stop();
    }

    prompts.length = 0;
    stdoutWriteSpy?.mockRestore();
    stdoutWriteSpy = null;
    stderrWriteSpy?.mockRestore();
    stderrWriteSpy = null;
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

  test("drops bracketed paste when the buffer exceeds the byte cap", () => {
    stdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true
    );
    const stderrChunks: string[] = [];
    stderrWriteSpy = spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array
    ) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);

    const renderer = new FakeRenderer();
    const terminalInput = new FakeTerminalInput();
    const prompt = new PersistentPrompt({
      onCancel: () => {},
      onSubmit: () => {},
      renderer,
      terminalInput: terminalInput as unknown as TerminalInput,
    });

    prompts.push(prompt);
    prompt.start();
    prompt.prefill("keep-me");

    terminalInput.emit(`\x1b[200~${"a".repeat(MAX_BRACKETED_PASTE_BYTES + 1)}`);

    expect(renderer.state?.value).toBe("keep-me");
    expect(stderrChunks.join("")).toContain("256 KB");

    terminalInput.emit("!");
    expect(renderer.state?.value).toBe("keep-me!");
  });
});
