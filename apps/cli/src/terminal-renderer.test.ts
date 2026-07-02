import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { TerminalLayout } from "./terminal-layout";
import type { PendingMessage } from "./message-queue";
import {
  buildComposerLines,
  type ComposerState,
  TerminalRenderer,
} from "./terminal-renderer";
import { plainLine, styledLine, styledLineWidth } from "./styled-text";

function composerLine(text: string, width: number) {
  return styledLine(`${text}${" ".repeat(Math.max(0, width - text.length))}`, {
    background: "surface",
  });
}

describe("buildComposerLines", () => {
  test("renders pending summaries, wrapped input, and selected suggestions", () => {
    const lines = buildComposerLines(
      {
        composer: {
          prefix: "> ",
          value: "abcdefgh",
          cursorVisible: true,
          suggestions: [{ label: "/help", description: "show help" }],
          selectedIndex: 0,
        },
        pendingMessages: [
          {
            line: "pending",
            sendInput: { message: "pending" },
          },
        ],
      },
      30,
    );

    expect(lines).toEqual([
      styledLine("⏳ pending: pending", { dim: true }),
      composerLine("", 30),
      composerLine("> abcdefgh▌", 30),
      composerLine("", 30),
      styledLine(`› ${"/help".padEnd(14)} show help`, { color: "cyan" }),
    ]);
  });

  test("keeps an empty prompt visible when there is no input", () => {
    const lines = buildComposerLines(
      {
        composer: {
          prefix: "> ",
          value: "",
          cursorVisible: true,
          suggestions: [],
          selectedIndex: 0,
        },
        pendingMessages: [],
      },
      80,
    );

    expect(lines).toEqual([composerLine("", 80), composerLine("> ▌", 80), composerLine("", 80)]);
  });

  test("keeps visible cursor within terminal width", () => {
    const width = 10;
    const lines = buildComposerLines(
      {
        composer: {
          prefix: "> ",
          value: "abcdefgh",
          cursorVisible: true,
          suggestions: [],
          selectedIndex: 0,
        },
        pendingMessages: [],
      },
      width,
    );

    expect(lines).toEqual([
      composerLine("", width),
      composerLine("> abcdefg", width),
      composerLine("  h▌", width),
      composerLine("", width),
    ]);
    expect(lines.every((line) => styledLineWidth(line) <= width)).toBe(true);
  });
});

describe("TerminalRenderer", () => {
  let setReservedRowsSpy: ReturnType<typeof spyOn<TerminalLayout, "setReservedRows">> | null = null;
  let writeStatusLineSpy: ReturnType<typeof spyOn<TerminalLayout, "writeStatusLine">> | null = null;
  let clearStatusLineSpy: ReturnType<typeof spyOn<TerminalLayout, "clearStatusLine">> | null = null;
  let writeScrollSpy: ReturnType<typeof spyOn<TerminalLayout, "writeScroll">> | null = null;
  let writelnScrollSpy: ReturnType<typeof spyOn<TerminalLayout, "writelnScroll">> | null = null;
  let writelnBelowStatusSpy: ReturnType<typeof spyOn<TerminalLayout, "writelnBelowStatus">> | null = null;
  let beginMessageSpy: ReturnType<typeof spyOn<TerminalLayout, "beginMessage">> | null = null;
  let endMessageSpy: ReturnType<typeof spyOn<TerminalLayout, "endMessage">> | null = null;
  let beginStreamSpy: ReturnType<typeof spyOn<TerminalLayout, "beginStream">> | null = null;
  let endStreamSpy: ReturnType<typeof spyOn<TerminalLayout, "endStream">> | null = null;

  afterEach(() => {
    setReservedRowsSpy?.mockRestore();
    writeStatusLineSpy?.mockRestore();
    clearStatusLineSpy?.mockRestore();
    writeScrollSpy?.mockRestore();
    writelnScrollSpy?.mockRestore();
    writelnBelowStatusSpy?.mockRestore();
    beginMessageSpy?.mockRestore();
    endMessageSpy?.mockRestore();
    beginStreamSpy?.mockRestore();
    endStreamSpy?.mockRestore();
    setReservedRowsSpy = null;
    writeStatusLineSpy = null;
    clearStatusLineSpy = null;
    writeScrollSpy = null;
    writelnScrollSpy = null;
    writelnBelowStatusSpy = null;
    beginMessageSpy = null;
    endMessageSpy = null;
    beginStreamSpy = null;
    endStreamSpy = null;
  });

  test("renders composer and pending state through the layout", () => {
    const layout = new TerminalLayout(null);
    const renderer = new TerminalRenderer(null, layout);
    const composerState: ComposerState = {
      prefix: "> ",
      value: "hello",
      cursorVisible: true,
      suggestions: [],
      selectedIndex: 0,
    };
    const pendingMessages: PendingMessage[] = [
      {
        line: "pending",
        sendInput: { message: "pending" },
      },
    ];

    setReservedRowsSpy = spyOn(layout, "setReservedRows").mockImplementation(() => {});

    renderer.setComposerState(composerState);
    renderer.setPendingMessages(pendingMessages);

    expect(setReservedRowsSpy).toHaveBeenLastCalledWith(4, [
      styledLine("⏳ pending: pending", { dim: true }),
      composerLine("", 80),
      composerLine("> hello▌", 80),
      composerLine("", 80),
    ]);
    expect(renderer.getState().composer).toEqual(composerState);
    expect(renderer.getState().pendingMessages).toEqual(pendingMessages);
  });

  test("tracks stream and transcript state with semantic methods", () => {
    const layout = new TerminalLayout(null);
    const renderer = new TerminalRenderer(null, layout);

    beginStreamSpy = spyOn(layout, "beginStream").mockImplementation(() => {});
    writeScrollSpy = spyOn(layout, "writeScroll").mockImplementation(() => {});
    endStreamSpy = spyOn(layout, "endStream").mockImplementation(() => {});
    writelnScrollSpy = spyOn(layout, "writelnScroll").mockImplementation(() => {});
    writelnBelowStatusSpy = spyOn(layout, "writelnBelowStatus").mockImplementation(() => {});

    renderer.appendOutputLine("intro");
    renderer.beginStream();
    renderer.appendStreamChunk("Hello");
    renderer.appendUserMessage("submitted", { placement: "scroll" });
    renderer.appendUserMessage("queued", { placement: "below_status" });
    renderer.endStream();

    const state = renderer.getState();

    expect(beginStreamSpy).toHaveBeenCalledTimes(1);
    expect(writeScrollSpy).toHaveBeenCalledWith("Hello");
    expect(writelnScrollSpy).toHaveBeenNthCalledWith(1, "intro");
    expect(writelnScrollSpy).toHaveBeenNthCalledWith(2, "> submitted");
    expect(writelnBelowStatusSpy).toHaveBeenCalledWith("> queued");
    expect(endStreamSpy).toHaveBeenCalledTimes(1);
    expect(state.stream).toEqual({ active: false, text: "" });
    expect(state.transcript).toEqual([
      { kind: "output", text: "intro" },
      { kind: "user", text: "> submitted" },
      { kind: "user", text: "> queued" },
      { kind: "assistant", text: "Hello" },
    ]);
  });

  test("routes tool lines through tool message blocks", () => {
    const layout = new TerminalLayout(null);
    const renderer = new TerminalRenderer(null, layout);
    const line = styledLine(" [tool: search] ", { dim: true });

    beginMessageSpy = spyOn(layout, "beginMessage").mockImplementation(() => {});
    writelnScrollSpy = spyOn(layout, "writelnScroll").mockImplementation(() => {});
    endMessageSpy = spyOn(layout, "endMessage").mockImplementation(() => {});

    renderer.appendToolLine(line);

    expect(beginMessageSpy).toHaveBeenCalledWith("tool");
    expect(writelnScrollSpy).toHaveBeenCalledWith(line);
    expect(endMessageSpy).toHaveBeenCalledTimes(1);
    expect(renderer.getState().transcript).toEqual([
      { kind: "output", text: " [tool: search] " },
    ]);
  });

  test("routes status updates through the layout", () => {
    const layout = new TerminalLayout(null);
    const renderer = new TerminalRenderer(null, layout);

    writeStatusLineSpy = spyOn(layout, "writeStatusLine").mockImplementation(() => {});
    clearStatusLineSpy = spyOn(layout, "clearStatusLine").mockImplementation(() => {});
    const line = styledLine("thinking", { dim: true });

    renderer.setStatusLine(line);
    renderer.setStatusLine(null);

    expect(writeStatusLineSpy).toHaveBeenCalledWith(line);
    expect(clearStatusLineSpy).toHaveBeenCalledTimes(1);
    expect(renderer.getState().statusLine).toBeNull();
  });
});
