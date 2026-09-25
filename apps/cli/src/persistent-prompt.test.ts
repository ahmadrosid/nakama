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
        onScrollHistory: () => {},
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
        expect(terminalInput.mouseTracking).toBe(false);
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

  test("attaches a pasted image path and preserves text typed while it loads", async () => {
    stdoutWriteSpy = spyOn(process.stdout, "write").mockReturnValue(true);
    const pending = Promise.withResolvers<{
      data: string;
      mediaType: string;
    }>();
    const image = { data: "aW1hZ2U=", mediaType: "image/png" };
    const read = spyOn(clipboard, "readClipboardImage").mockReturnValue(
      pending.promise
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
      terminalInput.emit("\x1b[200~'/tmp/screen shot.png'");
      terminalInput.emit("\x1b[201~");
      terminalInput.emit("\x1b[200~describe this\x1b[201~");
      terminalInput.emit("!");
      terminalInput.emit("\r");
      await Bun.sleep(0);
      expect(read).toHaveBeenCalledWith("/tmp/screen shot.png");
      expect(read).toHaveBeenCalledTimes(1);
      expect(submitted).toEqual([]);
      pending.resolve(image);
      await Bun.sleep(0);
      expect(submitted).toEqual([{ images: [image], text: "describe this!" }]);
    } finally {
      pending.resolve(image);
      read.mockRestore();
    }
  });

  test("keyboard scrolling reaches history without capturing mouse selection", () => {
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
    expect(terminalInput.mouseTracking).toBe(false);

    const { events } = consumeTerminalInput("\x1b[5~\x1b[6~\x1b[H\x1b[F");
    for (const event of events) {
      terminalInput.emit(event);
    }
    expect(scrolls).toEqual(["page_up", "page_down", "home", "end"]);
    expect(renderer.state?.value).toBe("unfinished draft");
    prompt.stop();
    expect(terminalInput.mouseTracking).toBe(false);
  });

  test("collapses text pastes, deletes whole blocks, and sends their original content", async () => {
    stdoutWriteSpy = spyOn(process.stdout, "write").mockReturnValue(true);
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
    prompt.start();
    prompt.prefill("Review: ");
    terminalInput.emit("\x1b[200~first\r\nsecond\x1b[201~");
    terminalInput.emit(" ");
    terminalInput.emit("\x1b[200~third\x1b[201~");
    terminalInput.emit("!");
    expect(renderer.state?.value).toBe("Review: [Text #1] [Text #2]!");
    terminalInput.emit("\u007f");
    terminalInput.emit("\u007f");
    expect(renderer.state?.value).toBe("Review: [Text #1] ");
    terminalInput.emit("\x1b[200~replacement\x1b[201~");
    terminalInput.emit("\r");
    await Bun.sleep(0);
    expect(submitted).toEqual([{ text: "Review: first\nsecond replacement" }]);
    expect(renderer.state?.value).toBe("");
    terminalInput.emit("\x1b[200~next draft\x1b[201~");
    expect(renderer.state?.value).toBe("[Text #1]");
    prompt.prefill("[Text #1]");
    terminalInput.emit("\r");
    await Bun.sleep(0);
    expect(submitted[1]).toEqual({ text: "[Text #1]" });
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
