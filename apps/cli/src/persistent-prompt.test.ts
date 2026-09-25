import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as clipboard from "./clipboard-image";
import type { PromptSuggestion } from "./commands";
import {
  MAX_BRACKETED_PASTE_BYTES,
  PersistentPrompt,
} from "./persistent-prompt";
import type { PromptLineResult } from "./prompt";
import { consumeTerminalInput, type TerminalInput } from "./terminal-input";
import type { ComposerState, TerminalRenderer } from "./terminal-renderer";

class FakeRenderer implements Pick<TerminalRenderer, "setComposerState"> {
  state: ComposerState | null = null;

  setComposerState(state: ComposerState): void {
    this.state = state;
  }
}

class FakeTerminalInput {
  mouseTracking = false;
  private listener: ((chunk: string) => void) | null = null;

  setMouseTracking(enabled: boolean): void {
    this.mouseTracking = enabled;
  }

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

  test.each(["\u0016", "\x1b[118;5u", "\x1b[27;5;118~", "\x1b[200~\x1b[201~"])(
    "pastes an image and sends it with the draft: %j",
    async (key) => {
      stdoutWriteSpy = spyOn(process.stdout, "write").mockReturnValue(true);
      const image = { data: "aW1hZ2U=", mediaType: "image/png" };
      const read = spyOn(clipboard, "readClipboardImage").mockResolvedValue(
        image
      );
      const terminalInput = new FakeTerminalInput();
      const renderer = new FakeRenderer();
      const submitted: PromptLineResult[] = [];
      const prompt = new PersistentPrompt({
        onCancel: () => {},
        onSubmit: (result) => submitted.push(result),
        renderer,
        terminalInput: terminalInput as unknown as TerminalInput,
      });
      prompts.push(prompt);
      try {
        prompt.start();
        prompt.prefill("Describe this");
        for (const event of consumeTerminalInput(key).events) {
          terminalInput.emit(event);
        }
        await Bun.sleep(0);
        expect(renderer.state?.imageCount).toBe(1);
        terminalInput.emit("\r");
        await Bun.sleep(0);
        expect(submitted).toEqual([{ images: [image], text: "Describe this" }]);
        expect(renderer.state?.imageCount).toBeUndefined();

        terminalInput.emit(key);
        await Bun.sleep(0);
        terminalInput.emit("\u007f");
        expect(renderer.state?.imageCount).toBeUndefined();
      } finally {
        read.mockRestore();
      }
    }
  );

  test("enter waits for every pending clipboard read", async () => {
    stdoutWriteSpy = spyOn(process.stdout, "write").mockReturnValue(true);
    const first = Promise.withResolvers<{ data: string; mediaType: string }>();
    const image = { data: "aW1hZ2U=", mediaType: "image/png" };
    const read = spyOn(clipboard, "readClipboardImage")
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(image);
    const terminalInput = new FakeTerminalInput();
    const submitted: PromptLineResult[] = [];
    const prompt = new PersistentPrompt({
      onCancel: () => {},
      onSubmit: (result) => submitted.push(result),
      renderer: new FakeRenderer(),
      terminalInput: terminalInput as unknown as TerminalInput,
    });
    prompts.push(prompt);
    try {
      prompt.start();
      terminalInput.emit("\u0016");
      terminalInput.emit("\u0016");
      terminalInput.emit("\r");
      await Bun.sleep(0);
      expect(submitted).toEqual([]);
      first.resolve(image);
      await Bun.sleep(0);
      expect(submitted).toEqual([{ images: [image, image], text: "" }]);
    } finally {
      first.resolve(image);
      read.mockRestore();
    }
  });

  test("trackpad scrolling reaches history without changing the draft", () => {
    stdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true
    );
    const terminalInput = new FakeTerminalInput();
    const renderer = new FakeRenderer();
    const scrolls: string[] = [];
    const prompt = new PersistentPrompt({
      onCancel: () => {},
      onScrollHistory: (event) => scrolls.push(event),
      onSubmit: () => {},
      renderer,
      terminalInput: terminalInput as unknown as TerminalInput,
    });
    prompts.push(prompt);
    prompt.start();
    prompt.prefill("unfinished draft");
    expect(terminalInput.mouseTracking).toBe(true);

    const { events } = consumeTerminalInput(
      "\x1b[<64;12;8M\x1b[<65;12;8M\x1b[<80;12;8M" +
        "\x1b[<0;12;8M\x1b[<64;12;8m\x1b[<66;12;8M"
    );
    for (const event of events) {
      terminalInput.emit(event);
    }
    expect(scrolls).toEqual(["line_up", "line_down", "line_up"]);
    expect(renderer.state?.value).toBe("unfinished draft");
    prompt.stop();
    expect(terminalInput.mouseTracking).toBe(false);
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

  test("enter submits the highlighted suggestion", async () => {
    stdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true
    );
    const terminalInput = new FakeTerminalInput();
    const submitted: PromptLineResult[] = [];
    const suggestion: PromptSuggestion = {
      description: "Claude Sonnet [Anthropic]",
      insertValue: "/model provider-a::claude-sonnet",
      label: "claude-sonnet",
      submitOnEnter: true,
    };
    const prompt = new PersistentPrompt({
      getSuggestions: (input) => (input === "/model " ? [suggestion] : []),
      onCancel: () => {},
      onSubmit: (result) => submitted.push(result),
      renderer: new FakeRenderer(),
      terminalInput: terminalInput as unknown as TerminalInput,
    });

    prompts.push(prompt);
    prompt.start();
    prompt.prefill("/model ");
    terminalInput.emit("\r");
    await Bun.sleep(0);

    expect(submitted).toEqual([{ text: "/model provider-a::claude-sonnet" }]);
  });

  test("enter keeps the typed command when suggestions are not selectable", async () => {
    stdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true
    );
    const terminalInput = new FakeTerminalInput();
    const submitted: PromptLineResult[] = [];
    const prompt = new PersistentPrompt({
      getSuggestions: () => [
        {
          description: "scaffold soul templates",
          insertValue: "/soul init",
          label: "init",
        },
      ],
      onCancel: () => {},
      onSubmit: (result) => submitted.push(result),
      renderer: new FakeRenderer(),
      terminalInput: terminalInput as unknown as TerminalInput,
    });

    prompts.push(prompt);
    prompt.start();
    prompt.prefill("/soul");
    terminalInput.emit("\r");
    await Bun.sleep(0);

    expect(submitted).toEqual([{ text: "/soul" }]);
  });

  test("shift+enter adds a new input line without submitting", () => {
    stdoutWriteSpy = spyOn(process.stdout, "write").mockImplementation(
      () => true
    );
    const renderer = new FakeRenderer();
    const terminalInput = new FakeTerminalInput();
    const submitted: PromptLineResult[] = [];
    const prompt = new PersistentPrompt({
      onCancel: () => {},
      onSubmit: (result) => submitted.push(result),
      renderer,
      terminalInput: terminalInput as unknown as TerminalInput,
    });

    prompts.push(prompt);
    prompt.start();
    prompt.prefill("first line");
    terminalInput.emit("\n");

    expect(renderer.state?.value).toBe("first line\n");
    expect(submitted).toEqual([]);

    terminalInput.emit("\x1b[13;2u");
    expect(renderer.state?.value).toBe("first line\n\n");
    expect(submitted).toEqual([]);

    terminalInput.emit("\x1b[27;2;13~");
    expect(renderer.state?.value).toBe("first line\n\n\n");
    expect(submitted).toEqual([]);
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
