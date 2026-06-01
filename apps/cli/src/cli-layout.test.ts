import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  computeReservedRows,
  getContentBottomLine,
  getInputStartLine,
  getPinnedInputStartLine,
  getTerminalColumns,
  getVisiblePinnedInputRows,
  shouldPinToBottom,
  TerminalLayout,
} from "./terminal-layout";
import {
  formatPendingDisplayLines,
  formatPendingSummary,
  MessageQueue,
} from "./message-queue";
import { TerminalInput } from "./terminal-input";

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

  test("ignores a cleared status row", () => {
    expect(
      getContentBottomLine({ lastOutputLine: 5, statusRow: null, streamRow: 4 }),
    ).toBe(5);
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

  test("keeps small prompts fully visible", () => {
    expect(getVisiblePinnedInputRows(3, 24)).toBe(3);
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

  test("sums pending and prompt rows", () => {
    expect(computeReservedRows({ pendingLineCount: 2, promptLineCount: 3 })).toBe(5);
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

  test("wraps long pending text", () => {
    const lines = formatPendingDisplayLines(
      [
        {
          line: "abcdefghijklmnopqrstuvwxyz",
          sendInput: { message: "abcdefghijklmnopqrstuvwxyz" },
        },
      ],
      20,
    );

    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("getTerminalColumns", () => {
  test("returns a positive width", () => {
    expect(getTerminalColumns()).toBeGreaterThan(0);
  });
});

describe("TerminalLayout rendering", () => {
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

  function createAnchoredLayout(contentBottomRow: number): TerminalLayout {
    const layout = new TerminalLayout(null);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      pinned: false,
      contentBottomRow,
    });

    return layout;
  }

  test("clears inline status rows before streamed output resumes", () => {
    captureStdout();
    const layout = createAnchoredLayout(5);

    layout.setReservedRows(1, ["> "]);
    writes = [];

    layout.writelnScroll("> hi");
    layout.writeStatusLine("thinking");

    expect((layout as Record<string, unknown>).contentBottomRow).toBe(6);

    writes = [];
    layout.clearStatusLine();

    const output = writes.join("");
    expect(output).toContain("\x1b[7;1H\x1b[K");
    expect(output).toContain("\x1b[8;1H\x1b[K");
    expect(output).toContain("\x1b[7;1H\x1b[K> ");
    expect((layout as Record<string, unknown>).statusAbsoluteRow).toBeNull();
    expect((layout as Record<string, unknown>).streamAbsoluteRow).toBe(7);
  });

  test("does not commit pinned status lines into scrollback", () => {
    captureStdout();
    const layout = createAnchoredLayout(22);

    layout.setReservedRows(2, ["> hi", "  there"]);
    writes = [];

    layout.writeStatusLine("thinking");

    const output = writes.join("");
    const internals = layout as Record<string, unknown>;
    const buffer = internals.buffer as Record<string, unknown>;

    expect(internals.statusAbsoluteRow).toBe(22);
    expect(output).toContain("\x1b[22;1H\x1b[Kthinking");
    expect(output).not.toContain("thinking\n");
    expect(buffer.contentLines).toEqual([]);
    expect(buffer.streamLine).toBe("");
  });

  test("renders pinned status after making room for it", () => {
    captureStdout();
    const layout = createAnchoredLayout(23);

    layout.setReservedRows(1, ["> "]);
    writes = [];

    layout.writeStatusLine("thinking");

    const output = writes.join("");
    expect(output).toContain("\x1b[24;1H\x1b[K> ");
    expect(output).toContain("\x1b[23;1H\x1b[Kthinking");
    expect(output.lastIndexOf("\x1b[23;1H\x1b[Kthinking")).toBeGreaterThan(
      output.lastIndexOf("\x1b[1;23r"),
    );
  });

  test("captures mouse wheel scrolling only while streaming", () => {
    captureStdout();
    const terminalInput = new TerminalInput();
    const setMouseTrackingSpy = spyOn(terminalInput, "setMouseTracking").mockImplementation(() => {});
    const layout = new TerminalLayout(terminalInput);

    Object.assign(layout as Record<string, unknown>, {
      enabled: true,
      anchored: true,
      pinned: false,
      contentBottomRow: 5,
    });

    layout.beginStream();
    layout.endStream();

    expect(setMouseTrackingSpy).toHaveBeenNthCalledWith(1, true);
    expect(setMouseTrackingSpy).toHaveBeenNthCalledWith(2, false);
    setMouseTrackingSpy.mockRestore();
  });

  test("clears the separator row before painting the next prompt", () => {
    captureStdout();
    const layout = createAnchoredLayout(5);

    layout.setReservedRows(1, ["> "]);
    layout.beginStream();
    layout.writelnScroll("> hi");
    layout.writeScroll("Hello");
    layout.setReservedRows(1, ["> "]);

    writes = [];
    layout.writelnScroll("");
    layout.endStream();

    const output = writes.join("");
    expect(output).toContain("\x1b[8;1H\x1b[K");
    expect(output).toContain("\x1b[9;1H\x1b[K> ");
  });

  test("scrolls transcript into scrollback for oversized pinned input", () => {
    captureStdout();
    const layout = createAnchoredLayout(5);
    const lines = Array.from({ length: 50 }, (_, index) =>
      `input-${String(index + 1).padStart(2, "0")}`,
    );

    layout.setReservedRows(lines.length, lines);

    const output = writes.join("");
    expect(output).toContain("\x1b[1;5r");
    expect(output).toContain("\x1b[5;1H");
    expect(output).toContain("\x1b[2;1H\x1b[Kinput-28");
    expect(output).toContain("\x1b[24;1H\x1b[Kinput-50");
    expect(output).not.toContain("input-27");
    expect(output).not.toContain("input-01");
    expect((layout as Record<string, unknown>).contentBottomRow).toBe(1);
  });
});
