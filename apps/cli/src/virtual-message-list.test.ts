import { expect, test } from "bun:test";
import { styledLineText } from "./styled-text";
import { VirtualMessageList } from "./virtual-message-list";

test("consecutive tools use one row each without blank gaps", () => {
  const list = new VirtualMessageList();
  for (const text of ["✓ read_file src/chat.ts", "✓ bash bun test"]) {
    list.beginMessage("tool");
    list.appendLine(text);
    list.sealMessage();
  }
  expect(list.totalLines(80)).toBe(2);
  expect(list.messageLines(1, 80)).toEqual([" ✓ bash bun test "]);
});

test("retains only the latest 1000 implicit messages after cached renders", () => {
  const list = new VirtualMessageList();
  for (let i = 0; i < 1100; i++) {
    list.appendLine(`message ${i}`);
    list.totalLines(80);
  }
  expect(list.messageCount).toBe(1000);
  expect(list.totalLines(80)).toBe(1000);
  expect(list.messageLines(0, 80)).toEqual([" message 100 "]);
  expect(list.messageLines(999, 80)).toEqual([" message 1099 "]);
  expect(list.messageAtLine(999, 80)).toEqual({ index: 999, lineOffset: 0 });
});

test("eviction preserves styled wrapping, gaps and the open message", () => {
  const list = new VirtualMessageList();
  const expected = new VirtualMessageList();
  for (let i = 0; i < 1005; i++) {
    const kind = i % 2 === 0 ? "user" : "assistant";
    list.beginMessage(kind);
    list.appendLine(`message ${i}\nsecond line`);
    list.sealMessage();
    list.totalLines(40);
    if (i >= 5) {
      expected.beginMessage(kind);
      expected.appendLine(`message ${i}\nsecond line`);
      expected.sealMessage();
    }
  }
  for (const messages of [list, expected]) {
    messages.beginMessage("assistant");
    messages.appendLine("still streaming");
  }
  expect(list.messageCount).toBe(1000);
  const width = 10;
  const total = expected.totalLines(width);
  expect(list.totalLines(width)).toBe(total);
  expect(list.getLines(0, total, width)).toEqual(
    expected.getLines(0, total, width)
  );
  list.sealMessage();
  expect(list.messageCount).toBe(1000);
  expect(list.messageLines(999, 80)).toEqual(["", " still streaming "]);
});

test("evicts without a prior render and clears retained history", () => {
  const list = new VirtualMessageList();
  for (let i = 0; i < 2001; i++) {
    list.appendLine(String(i));
  }
  expect(list.messageCount).toBe(1000);
  expect(list.messageLines(0, 80)).toEqual([" 1001 "]);
  list.clear();
  list.appendLine("fresh");
  expect(list.messageCount).toBe(1);
  expect(list.totalLines(80)).toBe(1);
  expect(list.messageLines(0, 80)).toEqual([" fresh "]);
});

test("renders assistant messages as markdown", () => {
  const list = new VirtualMessageList();
  list.beginMessage("assistant");
  list.appendLine("# Hello\n\nThis is **bold** and `code`.");
  list.sealMessage();

  const lines = list.getLines(0, list.totalLines(40), 40);
  expect(lines.map(styledLineText).join("\n")).not.toContain("**");
  expect(
    lines.some((line) => line.segments.some((segment) => segment.style?.bold))
  ).toBe(true);
  expect(
    lines.some((line) =>
      line.segments.some((segment) => segment.style?.color === "yellow")
    )
  ).toBe(true);
});
