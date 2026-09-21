import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  createSerializedQueue,
  formatPendingDisplayLines,
  formatPendingSummary,
} from "./message-queue";
import { plainLine, styledLine, styledLineText } from "./styled-text";
import { TerminalLayout } from "./terminal-layout";
import { buildComposerLines, TerminalRenderer } from "./terminal-renderer";
import { visibleLength } from "./text-measure";
import { VirtualMessageList } from "./virtual-message-list";

describe("formatPendingSummary", () => {
  test("uses image placeholder when only images are attached", () => {
    expect(
      formatPendingSummary({
        images: [{ data: "abc", mediaType: "image/png" }],
        line: "",
        sendInput: {
          images: [{ data: "abc", mediaType: "image/png" }],
          message: "",
        },
      })
    ).toBe("[image]");
  });
});

describe("createSerializedQueue", () => {
  test("runs tasks one after another", async () => {
    const queue = createSerializedQueue();
    const order: number[] = [];

    const first = queue.enqueue(async () => {
      await Bun.sleep(20);
      order.push(1);
    });
    const second = queue.enqueue(async () => {
      order.push(2);
    });

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  test("continues after a rejected task", async () => {
    const queue = createSerializedQueue();
    const order: string[] = [];

    const first = queue.enqueue(async () => {
      order.push("a");
      throw new Error("fail");
    });
    const second = queue.enqueue(async () => {
      order.push("b");
    });

    await expect(first).rejects.toThrow("fail");
    await second;
    expect(order).toEqual(["a", "b"]);
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
      80
    );

    expect(lines[0]).toContain("⏳ pending:");
    expect(lines[0]).toContain("follow up");
  });

  test("keeps pending lines within the terminal width", () => {
    const width = 56;
    const lines = formatPendingDisplayLines(
      [
        {
          line: "Profile: Default Bot (VdfJp6PY7m5hVM2dWX5xp) Provider: openai_compatible",
          sendInput: { message: "pending" },
        },
      ],
      width
    );

    expect(lines.every((line) => visibleLength(line) <= width)).toBe(true);
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

    expect(
      messages.getLines(0, messages.totalLines(20), 20).map(styledLineText)
    ).toEqual([" first ", "", " second "]);
  });

  test("keeps output entries compact without blank separators", () => {
    const messages = new VirtualMessageList();

    messages.beginMessage("output");
    messages.appendLine("first");
    messages.sealMessage();
    messages.beginMessage("output");
    messages.appendLine("second");
    messages.sealMessage();

    expect(
      messages.getLines(0, messages.totalLines(20), 20).map(styledLineText)
    ).toEqual([" first ", " second "]);
  });

  test("adds a blank line before tool message blocks", () => {
    const messages = new VirtualMessageList();

    messages.beginMessage("user");
    messages.appendLine("> hello");
    messages.sealMessage();
    messages.beginMessage("tool");
    messages.appendLine(" [tool: search] ");
    messages.sealMessage();

    expect(
      messages.getLines(0, messages.totalLines(30), 30).map(styledLineText)
    ).toEqual([
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

    const lines = messages
      .getLines(0, messages.totalLines(12), 12)
      .map(styledLineText);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.startsWith(" ")).toBe(true);
      expect(line.endsWith(" ")).toBe(true);
    }
  });
});

describe("TerminalLayout frame pipeline", () => {
  let writeSpy: ReturnType<
    typeof spyOn<typeof process.stdout, "write">
  > | null = null;
  let originalColumns: number | undefined;
  let originalRows: number | undefined;
  let writes: string[] = [];

  afterEach(() => {
    writeSpy?.mockRestore();
    writeSpy = null;
    if (originalColumns === undefined) {
      delete (process.stdout as Record<string, unknown>).columns;
    } else {
      Object.defineProperty(process.stdout, "columns", {
        configurable: true,
        value: originalColumns,
      });
    }
    if (originalRows === undefined) {
      delete (process.stdout as Record<string, unknown>).rows;
    } else {
      Object.defineProperty(process.stdout, "rows", {
        configurable: true,
        value: originalRows,
      });
    }
    originalColumns = undefined;
    originalRows = undefined;
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
    if (originalColumns === undefined) {
      originalColumns = process.stdout.columns;
    }
    if (originalRows === undefined) {
      originalRows = process.stdout.rows;
    }
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: columns,
    });
    Object.defineProperty(process.stdout, "rows", {
      configurable: true,
      value: rows,
    });
  }

  test("uses pi-tui synchronized paints without clearing scrollback", () => {
    captureStdout();
    setTerminalSize(80, 10);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      enabled: true,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    writes = [];
    layout.writelnScroll("hello");
    const firstOutput = writes.join("");

    writes = [];
    layout.writelnScroll("world");
    const secondOutput = writes.join("");

    expect(firstOutput).toContain("\x1b[");
    expect(firstOutput).toContain("\x1b[?2026h");
    expect(firstOutput).not.toContain("\x1b[3J");
    expect(secondOutput).toContain("\x1b[");
    expect(secondOutput).not.toContain("\x1b[3J");
    expect(secondOutput).not.toContain("\x1b[1;1H");
  });

  test("keeps the native cursor beside the drawn prompt cursor", () => {
    captureStdout();
    setTerminalSize(80, 10);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      enabled: true,
    });

    layout.setReservedRows(
      3,
      buildComposerLines(
        {
          composer: {
            cursorVisible: true,
            prefix: "> ",
            selectedIndex: 0,
            suggestions: [],
            value: "",
          },
          pendingMessages: [],
        },
        80
      )
    );

    // pi-tui positions the hardware cursor with a relative row move and an
    // absolute column move; the column must remain beside the drawn cursor.
    expect(writes.join("")).toContain("\x1b[4G");
    expect(writes.join("")).not.toContain("\x1b[80G");
  });

  test("serializes styled status line through frame serializer", () => {
    captureStdout();
    setTerminalSize(80, 10);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      enabled: true,
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
      anchored: true,
      anchorRow: 4,
      enabled: true,
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
      anchored: true,
      anchorRow: 1,
      enabled: true,
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

  test("clears the transcript and redraws the composer from the top", () => {
    captureStdout();
    setTerminalSize(80, 12);
    const layout = new TerminalLayout(null);
    Object.assign(layout, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
    });
    const renderer = new TerminalRenderer(null, layout);
    renderer.setComposerState(renderer.getState().composer);
    renderer.appendOutputLine("old message");
    renderer.setStatusLine(plainLine("old status"));
    renderer.scrollPage(1);

    writes = [];
    renderer.clear();

    expect(writes.join("")).toContain("\x1b[2J\x1b[3J\x1b[H");
    expect(layout.previousFrame?.topRow).toBe(1);
    expect(layout.getLastOutputLine()).toBe(0);
    expect(renderer.getState().statusLine).toBeNull();
    expect(layout.previousFrame?.lines.map(styledLineText).slice(0, 4)).toEqual(
      ["", " ".repeat(80), "> ▌" + " ".repeat(77), " ".repeat(80)]
    );
    renderer.scrollPage(1);
    expect(writes.join("")).not.toContain("old message");
    renderer.appendOutputLine("new message");
    expect(writes.join("")).toContain("new message");
    expect(layout.isEnabled()).toBe(true);
  });

  test("scrolls within retained history and returns to live output after eviction", () => {
    captureStdout();
    setTerminalSize(80, 8);
    const layout = new TerminalLayout(null);
    Object.assign(layout, { anchored: true, anchorRow: 1, enabled: true });
    layout.setReservedRows(1, [plainLine("> ")]);
    for (let index = 0; index < 1001; index++) {
      layout.writelnScroll(`retained-${index}`);
    }

    writes = [];
    layout.scrollLines(10_000);
    expect(writes.join("")).toContain(" retained-1 ");
    expect(writes.join("")).not.toContain(" retained-0 ");

    writes = [];
    layout.writelnScroll("retained-1001");
    expect(writes.join("")).toContain("retained-7");
    expect(layout.getLastOutputLine()).toBe(1000);

    writes = [];
    layout.scrollToLatest();
    expect(writes.join("")).toContain(" retained-1001 ");
    writes = [];
    layout.writelnScroll("retained-1002");
    expect(writes.join("")).toContain(" retained-1002 ");
  });

  test("grows viewport upward as transcript gets longer", () => {
    captureStdout();
    setTerminalSize(80, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
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
      anchored: true,
      anchorRow: 1,
      enabled: true,
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
      anchored: true,
      anchorRow: 2,
      enabled: true,
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
      anchored: true,
      anchorRow: 8,
      enabled: true,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.writeScroll(
      "this is a long streaming line that wraps across many rows in viewport"
    );
    const grownTop =
      (
        (layout as Record<string, unknown>).previousFrame as {
          topRow: number;
        } | null
      )?.topRow ?? 8;

    // Starting a new stream clears transient stream buffer; viewport should not shrink downward.
    layout.beginStream();
    const afterResetTop =
      (
        (layout as Record<string, unknown>).previousFrame as {
          topRow: number;
        } | null
      )?.topRow ?? 8;

    expect(afterResetTop).toBeLessThanOrEqual(grownTop);
  });

  test("pads streaming lines on both sides before the message is sealed", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("assistant");
    layout.writeScroll("1234567890 1234567890 1234567890");

    const frame = (layout as Record<string, unknown>).previousFrame as {
      lines: Array<{ segments: Array<{ text: string }> }>;
    } | null;
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

  test("preserves markdown after streaming across user and tool messages", () => {
    captureStdout();
    setTerminalSize(80, 30);
    const layout = new TerminalLayout(null);
    Object.assign(layout, {
      anchored: true,
      anchorRow: 1,
      enabled: true,
      viewportTopRow: 1,
    });
    const renderer = new TerminalRenderer(null, layout);
    renderer.beginStream();
    renderer.appendUserMessage("question");
    renderer.appendStreamChunk("**Before**");
    renderer.appendToolLine("tool result");
    renderer.appendStreamChunk("**After**");
    renderer.endStream();

    const messages = (layout as unknown as { messages: VirtualMessageList })
      .messages;
    const lines = messages.getLines(0, messages.totalLines(80), 80);
    expect(lines.map(styledLineText).filter((line) => line.trim())).toEqual([
      "> question".padEnd(80),
      " Before ",
      " tool result ",
      " After ",
    ]);
    for (const text of ["Before", "After"]) {
      expect(
        lines.some((line) =>
          line.segments.some(
            (segment) => segment.text === text && segment.style?.bold
          )
        )
      ).toBe(true);
    }
  });

  test("renders markdown while the assistant stream is still open", () => {
    captureStdout();
    setTerminalSize(40, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("assistant");
    layout.writeScroll("This is **bold**.");

    const frame = (layout as Record<string, unknown>).previousFrame as {
      lines: Array<{
        segments: Array<{ text: string; style?: { bold?: boolean } }>;
      }>;
    } | null;

    expect(
      frame?.lines.some((line) =>
        line.segments.some((segment) => segment.style?.bold === true)
      )
    ).toBe(true);
  });

  test("adds a blank row between submitted input and active stream", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
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
      frame?.lines.map((line) =>
        line.segments.map((segment) => segment.text).join("")
      ) ?? [];

    expect(renderedLines).toContain("> hello             ");
    expect(renderedLines).toContain("");
    expect(renderedLines).toContain(" response ");
    expect(renderedLines.indexOf("")).toBeLessThan(
      renderedLines.indexOf(" response ")
    );
  });

  test("adds a blank row between submitted input and thinking status", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
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
      frame?.lines.map((line) =>
        line.segments.map((segment) => segment.text).join("")
      ) ?? [];

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

  test("adds extra blank space above a sealed assistant reply", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("user");
    layout.writelnScroll("> hello");
    layout.endMessage();
    layout.beginMessage("assistant");
    layout.writeScroll("Morning! What's on your mind today?");
    layout.endStream();
    layout.endMessage();

    const frame = (layout as Record<string, unknown>).previousFrame as {
      lines: Array<{ segments: Array<{ text: string }> }>;
    } | null;
    const renderedLines =
      frame?.lines.map((line) =>
        line.segments.map((segment) => segment.text).join("")
      ) ?? [];

    expect(renderedLines).toEqual([
      "                    ",
      "> hello             ",
      "                    ",
      "",
      "",
      " Morning! What's on ",
      " your mind today? ",
      "",
      "> ",
    ]);
  });

  test("keeps streamed text wrapping stable after sealing the message", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("assistant");
    layout.writeScroll("1234567890 1234567890 1234567890");

    const frameBeforeSeal = (layout as Record<string, unknown>)
      .previousFrame as {
      lines: Array<{ segments: Array<{ text: string }> }>;
    } | null;
    const streamedLines =
      frameBeforeSeal?.lines
        .map((line) => line.segments.map((segment) => segment.text).join(""))
        .filter(
          (line) => line.includes("1234567890") || line.includes("890 ")
        ) ?? [];

    layout.endStream();
    layout.endMessage();

    const frameAfterSeal = (layout as Record<string, unknown>)
      .previousFrame as {
      lines: Array<{ segments: Array<{ text: string }> }>;
    } | null;
    const sealedLines =
      frameAfterSeal?.lines
        .map((line) => line.segments.map((segment) => segment.text).join(""))
        .filter(
          (line) => line.includes("1234567890") || line.includes("890 ")
        ) ?? [];

    expect(sealedLines).toEqual(streamedLines);
  });

  test("grows viewport one line at a time", () => {
    captureStdout();
    setTerminalSize(80, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    // initial viewport rows = 5 (rows 8..12)
    let frame = (layout as Record<string, unknown>).previousFrame as {
      topRow: number;
    } | null;
    expect(frame?.topRow).toBe(8);

    layout.writelnScroll("line-1");
    layout.writelnScroll("line-2");
    layout.writelnScroll("line-3");
    layout.writelnScroll("line-4");
    layout.writelnScroll("line-5");
    // Implicit output writes stay compact: 5 messages occupy 5 transcript rows.
    frame = (layout as Record<string, unknown>).previousFrame as {
      topRow: number;
    } | null;
    expect(frame?.topRow).toBe(6);

    layout.writelnScroll("line-6");
    frame = (layout as Record<string, unknown>).previousFrame as {
      topRow: number;
    } | null;
    expect(frame?.topRow).toBe(5);
  });

  test("uses wrapped row count to grow into free space", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    // This single logical line wraps into multiple terminal rows at width=20.
    layout.writelnScroll(
      "1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890"
    );

    const frame = (layout as Record<string, unknown>).previousFrame as {
      topRow: number;
    } | null;
    expect(frame?.topRow).toBeLessThan(8);
  });

  test("auto-follows open virtual messages before they are sealed", () => {
    captureStdout();
    setTerminalSize(20, 12);
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      anchored: true,
      anchorRow: 8,
      enabled: true,
      viewportTopRow: 8,
    });

    layout.setReservedRows(1, [plainLine("> ")]);
    layout.beginMessage("assistant");
    layout.writelnScroll(
      "1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890"
    );

    const frame = (layout as Record<string, unknown>).previousFrame as {
      topRow: number;
    } | null;
    expect(frame?.topRow).toBeLessThan(8);
  });
});
