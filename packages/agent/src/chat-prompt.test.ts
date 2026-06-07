import { expect, test } from "bun:test";
import { buildChatSystemPrompt } from "./chat-prompt";

test("buildChatSystemPrompt inserts USER.md section after identity", () => {
  const prompt = buildChatSystemPrompt([], {
    basePrompt: "You are a helpful assistant.",
    userContext: "Name: Alex\nRole: engineer",
  });

  const identityIndex = prompt.indexOf("You are a helpful assistant.");
  const userIndex = prompt.indexOf("# About the User (USER.md)");
  const runtimeIndex = prompt.indexOf("Chat naturally");

  expect(identityIndex).toBeGreaterThanOrEqual(0);
  expect(userIndex).toBeGreaterThan(identityIndex);
  expect(runtimeIndex).toBeGreaterThan(userIndex);
  expect(prompt).toContain("Name: Alex\nRole: engineer");
});

test("buildChatSystemPrompt omits USER.md section when empty", () => {
  const prompt = buildChatSystemPrompt([], {
    basePrompt: "You are a helpful assistant.",
    userContext: "   ",
  });

  expect(prompt).not.toContain("# About the User (USER.md)");
});

test("buildChatSystemPrompt includes todo_write guidance when tool is available", () => {
  const prompt = buildChatSystemPrompt(
    [{ name: "todo_write", description: "Track tasks", parameters: { type: "object", properties: {} } }],
    { enableToolLoop: true },
  );

  expect(prompt).toContain("todo_write");
  expect(prompt).toContain("merge: true");
  expect(prompt).toContain("continue unfinished tasks");
});
