import { expect, test } from "bun:test";
import { VirtualMessageList } from "./virtual-message-list";

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

test("eviction preserves styled wrapping, gaps, navigation and the open message", () => {
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
  for (const width of [40, 10, 80]) {
    const total = expected.totalLines(width);
    expect(list.totalLines(width)).toBe(total);
    expect(list.getLines(0, total, width)).toEqual(
      expected.getLines(0, total, width)
    );
    for (const line of [0, 1, 5, total - 1]) {
      expect(list.messageAtLine(line, width)).toEqual(
        expected.messageAtLine(line, width)
      );
      expect(list.snapToMessage(line, "up", width)).toBe(
        expected.snapToMessage(line, "up", width)
      );
      expect(list.snapToMessage(line, "down", width)).toBe(
        expected.snapToMessage(line, "down", width)
      );
    }
  }
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
