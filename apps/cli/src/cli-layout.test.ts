import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  computeReservedRows,
  getContentBottomLine,
  getInputStartLine,
  getPinnedInputStartLine,
  getVisiblePinnedInputRows,
  shouldPinToBottom,
  TerminalLayout,
} from "./terminal-layout";
import {
  formatPendingDisplayLines,
  formatPendingSummary,
  MessageQueue,
} from "./message-queue";
import { plainLine, styledLine, styledLineText } from "./styled-text";
import { VirtualMessageList } from "./virtual-message-list";

describe("shouldPinToBottom", () => {
  test("stays inline while there is room for input", () => {
    expect(shouldPinToBottom(5, 2, 24)).toBe(false);
  });

  test("pins when input would overflow the terminal", () => {
    expect(shouldPinToBottom(22, 2, 24)).toBe(true);
  });
});

describe("getContentBottomLine", () => {
  test("uses the furthest active row", () => {
    expect(
      getContentBottomLine({ lastOutputLine: 5, statusRow: 7, streamRow: 6 }),
    ).toBe(7);
  });
});

describe("getInputStartLine", () => {
  test("places input directly after output", () => {
    expect(getInputStartLine(5)).toBe(6);
    expect(getInputStartLine(0)).toBe(1);
  });
});

describe("getVisiblePinnedInputRows", () => {
  test("uses the full available viewport for oversized pinned input", () => {
    expect(getVisiblePinnedInputRows(50, 24)).toBe(23);
  });
});

describe("getPinnedInputStartLine", () => {
  test("starts oversized pinned input at the first visible composer row", () => {
    expect(getPinnedInputStartLine(50, 24)).toBe(2);
  });
});

describe("computeReservedRows", () => {
  test("requires at least one row", () => {
    expect(computeReservedRows({ pendingLineCount: 0, promptLineCount: 0 })).toBe(1);
  });
});

describe("MessageQueue", () => {
  test("dequeues in fifo order", () => {
    const queue = new MessageQueue();

    queue.enqueue({
      line: "first",
      sendInput: { message: "first" },
    });
    queue.enqueue({
      line: "second",
      sendInput: { message: "second" },
    });

    expect(queue.dequeue()?.line).toBe("first");
    expect(queue.dequeue()?.line).toBe("second");
    expect(queue.dequeue()).toBeUndefined();
  });
});

describe("formatPendingSummary", () => {
  test("uses image placeholder when only images are attached", () => {
    expect(
      formatPendingSummary({
        line: "",
        images: [{ mediaType: "image/png", data: "abc" }],
        sendInput: { message: "", images: [{ mediaType: "image/png", data: "abc" }] },
      }),
    ).toBe("[image]");
  });
});

describe("formatPendingDisplayLines", () => {
  test("formats pending lines with prefix", () => {
    const lines = formatPendingDisplayLines(
      [
        {
          line: "follow up",
          sendInput: { message: "follow up" },
        },
      ],
      80,
    );

    expect(lines[0]).toContain("⏳ pending:");
    expect(lines[0]).toContain("follow up");
  });
});

describe("VirtualMessageList", () => {
  test("adds a blank line before conversational message blocks", () => {
    const messages = new VirtualMessageList();

    messages.beginMessage("output");
    messages.appendLine("first");
    messages.sealMessage();
    messages.beginMessage("assistant");
    messages.appendLine("second");
    messages.sealMessage();

    expect(messages.getLines(0, messages.totalLines(20), 20).map(styledLineText)).toEqual([
      " first ",
      "",
      " second ",
    ]);
  });

  test("keeps output entries compact without blank separators", () => {
    const messages = new VirtualMessageList();

    messages.beginMessage("output");
    messages.appendLine("first");
    messages.sealMessage();
    messages.beginMessage("output");
    messages.appendLine("second");
    messages.sealMessage();

    expect(messages.getLines(0, messages.totalLines(20), 20).map(styledLineText)).toEqual([
      " first ",
      " second ",
    ]);
  });

  test("adds a blank line before tool message blocks", () => {
    const messages = new VirtualMessageList();

    messages.beginMessage("user");
    messages.appendLine("> hello");
    messages.sealMessage();
    messages.beginMessage("tool");
    messages.appendLine(" [tool: search] ");
    messages.sealMessage();

    expect(messages.getLines(0, messages.totalLines(30), 30).map(styledLineText)).toEqual([
      "                              ",
      "> hello                       ",
      "                              ",
      "",
      "  [tool: search]  ",
    ]);
  });

  test("pads wrapped transcript lines on both sides", () => {
    const messages = new VirtualMessageList();

    messages.beginMessage("assistant");
    messages.appendLine("1234567890 1234567890 1234567890");
    messages.sealMessage();

    const lines = messages.getLines(0, messages.totalLines(12), 12).map(styledLineText);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.startsWith(" ")).toBe(true);
      expect(line.endsWith(" ")).toBe(true);
    }
  });
});

describe("TerminalLayout frame pipeline", () => {
  let writeSpy: ReturnType<typeof spyOn<typeof process.stdout, "write">> | null = null;
  let writes: string[] = [];

  afterEach(() => {
    writeSpy?.mockRestore();
    writeSpy = null;
    writes = [];
  });

  function captureStdout(): void {
    writes = [];
    writeSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  }

  function setTerminalSize(columns: number, rows: number): void {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: columns,
    });
    Object.defineProperty(process.stdout, "rows", {
      configurable: true,
      value: rows,
    });
  }

  test("diff-renders only changed lines", async () => {
    captureStdout();
    setTerminalSize(80, 10);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    writes = [];
    layout.writelnScroll("hello");
    const firstOutput = writes.join("");

    writes = [];
    layout.writelnScroll("world");
    const secondOutput = writes.join("");

    expect(firstOutput).toContain("\x1b[");
    expect(secondOutput).toContain("\x1b[");
    expect(secondOutput.length).toBeLessThan(firstOutput.length * 2);
  });

  test("serializes styled status line through frame serializer", () => {
    captureStdout();
    setTerminalSize(80, 10);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    writes = [];
    layout.writeStatusLine(styledLine("thinking", { dim: true }));

    const output = writes.join("");
    expect(output).toContain("\x1b[2mthinking");
  });

  test("keeps input near content when there is space", () => {
    captureStdout();
    setTerminalSize(80, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 4,
    });

    layout.setReservedRows(1, [plainLine("> hi▌")]);
    writes = [];
    layout.writelnScroll("hello");

    const output = writes.join("");
    expect(output).toContain("hello");
    expect(output).toContain("> hi▌");
    expect(output).not.toContain("\x1b[12;");
  });

  test("scrolls back to older transcript lines", () => {
    captureStdout();
    setTerminalSize(80, 8);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 1,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    for (let index = 1; index <= 10; index += 1) {
      layout.writelnScroll(`line-${String(index).padStart(2, "0")}`);
    }

    writes = [];
    layout.scrollPage(1);

    const output = writes.join("");
    expect(output).toContain(" line-05 ");
  });

  test("grows viewport upward as transcript gets longer", () => {
    captureStdout();
    setTerminalSize(80, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    for (let index = 1; index <= 8; index += 1) {
      layout.writelnScroll(`grow-${index}`);
    }

    const internals = layout as Record<string, unknown>;
    const previousFrame = internals.previousFrame as { topRow: number } | null;
    expect(previousFrame?.topRow ?? 8).toBeLessThan(8);
    expect(previousFrame?.topRow ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("auto-follows newest output when at latest", () => {
    captureStdout();
    setTerminalSize(80, 8);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 1,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    for (let index = 1; index <= 10; index += 1) {
      layout.writelnScroll(`tail-${index}`);
    }

    layout.scrollPage(1);
    let internals = layout as Record<string, unknown>;
    expect(internals.historyOffset as number).toBeGreaterThan(0);
    expect(internals.followOutput as boolean).toBe(false);

    layout.scrollToLatest();
    layout.writelnScroll("tail-latest");

    internals = layout as Record<string, unknown>;
    expect(internals.historyOffset).toBe(0);
    expect(internals.followOutput).toBe(true);
  });

  test("renders debug overlay line when enabled", () => {
    captureStdout();
    setTerminalSize(80, 8);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 2,
    });

    layout.setDebugOverlay(true);
    layout.setReservedRows(1, [plainLine("> ")]);
    writes = [];
    layout.writelnScroll("hello");

    const output = writes.join("");
    expect(output).toContain("dbg a:");
  });

  test("does not shrink viewport after it has grown", () => {
    captureStdout();
    setTerminalSize(80, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 8,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.writeScroll("this is a long streaming line that wraps across many rows in viewport");
    const grownTop = ((layout as Record<string, unknown>).previousFrame as { topRow: number } | null)
      ?.topRow ?? 8;

    // Starting a new stream clears transient stream buffer; viewport should not shrink downward.
    layout.beginStream();
    const afterResetTop = ((layout as Record<string, unknown>).previousFrame as { topRow: number } | null)
      ?.topRow ?? 8;

    expect(afterResetTop).toBeLessThanOrEqual(grownTop);
  });

  test("pads streaming lines on both sides before the message is sealed", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 8,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("assistant");
    layout.writeScroll("1234567890 1234567890 1234567890");

    const frame = (layout as Record<string, unknown>).previousFrame as { lines: Array<{ segments: Array<{ text: string }> }> } | null;
    const transcriptLines =
      frame?.lines
        .map((line) => line.segments.map((segment) => segment.text).join(""))
        .filter((line) => line.includes("1234567890")) ?? [];

    expect(transcriptLines.length).toBeGreaterThan(0);
    for (const line of transcriptLines) {
      expect(line.startsWith(" ")).toBe(true);
      expect(line.endsWith(" ")).toBe(true);
    }
  });

  test("adds a blank row between submitted input and active stream", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 8,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("user");
    layout.writelnScroll("> hello");
    layout.endMessage();
    layout.beginMessage("assistant");
    layout.writeScroll("response");

    const frame = (layout as Record<string, unknown>).previousFrame as {
      lines: Array<{ segments: Array<{ text: string }> }>;
    } | null;
    const renderedLines =
      frame?.lines.map((line) => line.segments.map((segment) => segment.text).join("")) ?? [];

    expect(renderedLines).toContain("> hello             ");
    expect(renderedLines).toContain("");
    expect(renderedLines).toContain(" response ");
    expect(renderedLines.indexOf("")).toBeLessThan(renderedLines.indexOf(" response "));
  });

  test("adds a blank row between submitted input and thinking status", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 8,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("user");
    layout.writelnScroll("> hello");
    layout.endMessage();
    layout.writeStatusLine(styledLine(" ⠋ Thinking ", { dim: true }));

    const frame = (layout as Record<string, unknown>).previousFrame as {
      lines: Array<{ segments: Array<{ text: string }> }>;
    } | null;
    const renderedLines =
      frame?.lines.map((line) => line.segments.map((segment) => segment.text).join("")) ?? [];

    expect(renderedLines).toEqual([
      "                    ",
      "> hello             ",
      "                    ",
      "",
      " ⠋ Thinking ",
      "",
      "> ",
    ]);
  });

  test("keeps streamed text wrapping stable after sealing the message", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 8,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("assistant");
    layout.writeScroll("1234567890 1234567890 1234567890");

    const frameBeforeSeal = (layout as Record<string, unknown>).previousFrame as {
      lines: Array<{ segments: Array<{ text: string }> }>;
    } | null;
    const streamedLines =
      frameBeforeSeal?.lines
        .map((line) => line.segments.map((segment) => segment.text).join(""))
        .filter((line) => line.includes("1234567890") || line.includes("890 ")) ?? [];

    layout.endStream();
    layout.endMessage();

    const frameAfterSeal = (layout as Record<string, unknown>).previousFrame as {
      lines: Array<{ segments: Array<{ text: string }> }>;
    } | null;
    const sealedLines =
      frameAfterSeal?.lines
        .map((line) => line.segments.map((segment) => segment.text).join(""))
        .filter((line) => line.includes("1234567890") || line.includes("890 ")) ?? [];

    expect(sealedLines).toEqual(streamedLines);
  });

  test("grows viewport one line at a time", () => {
    captureStdout();
    setTerminalSize(80, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 8,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    // initial viewport rows = 5 (rows 8..12)
    let frame = (layout as Record<string, unknown>).previousFrame as { topRow: number } | null;
    expect(frame?.topRow).toBe(8);

    layout.writelnScroll("line-1");
    layout.writelnScroll("line-2");
    layout.writelnScroll("line-3");
    layout.writelnScroll("line-4");
    layout.writelnScroll("line-5");
    // Implicit output writes stay compact: 5 messages occupy 5 transcript rows.
    frame = (layout as Record<string, unknown>).previousFrame as { topRow: number } | null;
    expect(frame?.topRow).toBe(6);

    layout.writelnScroll("line-6");
    frame = (layout as Record<string, unknown>).previousFrame as { topRow: number } | null;
    expect(frame?.topRow).toBe(5);
  });

  test("uses wrapped row count to grow into free space", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 8,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    // This single logical line wraps into multiple terminal rows at width=20.
    layout.writelnScroll(
      "1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890",
    );

    const frame = (layout as Record<string, unknown>).previousFrame as { topRow: number } | null;
    expect(frame?.topRow).toBeLessThan(8);
  });

  test("auto-follows open virtual messages before they are sealed", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      anchorRow: 8,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("assistant");
    layout.writelnScroll(
      "1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890",
    );

    const frame = (layout as Record<string, unknown>).previousFrame as { topRow: number } | null;
    expect(frame?.topRow).toBeLessThan(8);
  });
});
