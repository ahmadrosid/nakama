import { expect, test } from "bun:test";
import { buildChatSystemPrompt } from "./chat-prompt";

test("buildChatSystemPrompt includes automation skill pointer when create_automation is available", () => {
  const prompt = buildChatSystemPrompt(
    [
      {
        name: "create_automation",
        description: "Create automations",
        parameters: { type: "object", properties: {} },
      },
    ],
    { enableToolLoop: true },
  );

  expect(prompt).toContain("create-automation skill");
  expect(prompt).not.toContain("5-field cron syntax");
  expect(prompt).not.toContain("runAt");
});

test("buildChatSystemPrompt omits automation guidance when create_automation is unavailable", () => {
  const prompt = buildChatSystemPrompt(
    [{ name: "write_file", description: "Write", parameters: { type: "object", properties: {} } }],
    { enableToolLoop: true },
  );

  expect(prompt).not.toContain("create-automation skill");
  expect(prompt).not.toContain("5-field cron syntax");
});

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

test("buildChatSystemPrompt includes ask_user_question guidance when tool is available", () => {
  const prompt = buildChatSystemPrompt(
    [{ name: "ask_user_question", description: "Questions", parameters: { type: "object", properties: {} } }],
    { enableToolLoop: true },
  );

  expect(prompt).toContain("ask_user_question");
  expect(prompt).toContain("missing information");
  expect(prompt).toContain("wait for the user's answers");
});

test("buildChatSystemPrompt includes update_profile_memory guidance when tool is available", () => {
  const prompt = buildChatSystemPrompt(
    [{ name: "update_profile_memory", description: "Memory", parameters: { type: "object", properties: {} } }],
    { enableToolLoop: true },
  );

  expect(prompt).toContain("update_profile_memory");
  expect(prompt).toContain("facts, preferences, and personal context");
  expect(prompt).toContain("create_skill");
});

test("buildChatSystemPrompt includes archive_profile_memory guidance when tool is available", () => {
  const prompt = buildChatSystemPrompt(
    [{ name: "archive_profile_memory", description: "Archive memory", parameters: { type: "object", properties: {} } }],
    { enableToolLoop: true },
  );

  expect(prompt).toContain("archive_profile_memory");
  expect(prompt).toContain("data/memory-archive/");
  expect(prompt).toContain("search_files");
});

test("buildChatSystemPrompt includes create_skill guidance when tool is available", () => {
  const prompt = buildChatSystemPrompt(
    [{ name: "create_skill", description: "Skill", parameters: { type: "object", properties: {} } }],
    { enableToolLoop: true },
  );

  expect(prompt).toContain("create_skill");
  expect(prompt).toContain("step-by-step workflows and repeatable procedures");
  expect(prompt).toContain("update_profile_memory");
});

test("buildChatSystemPrompt omits memory and skill guidance when tools are not present", () => {
  const prompt = buildChatSystemPrompt(
    [{ name: "write_file", description: "Write", parameters: { type: "object", properties: {} } }],
    { enableToolLoop: true },
  );

  expect(prompt).not.toContain("update_profile_memory");
  expect(prompt).not.toContain("create_skill");
});

test("buildChatSystemPrompt omits tool guidance when enableToolLoop is false", () => {
  const prompt = buildChatSystemPrompt(
    [{ name: "update_profile_memory", description: "Memory", parameters: { type: "object", properties: {} } }],
    { enableToolLoop: false },
  );

  expect(prompt).not.toContain("update_profile_memory");
  expect(prompt).not.toContain("create_skill");
});

test("buildChatSystemPrompt adds private chat guidance for telegram and whatsapp", () => {
  const telegram = buildChatSystemPrompt([], { channel: "telegram" });
  const whatsapp = buildChatSystemPrompt([], { channel: "whatsapp" });

  expect(telegram).toContain("private Telegram chat");
  expect(telegram).toContain("Write like texting a friend");
  expect(telegram).toContain("plain text only");

  expect(whatsapp).toContain("private WhatsApp chat");
  expect(whatsapp).toContain("Write like texting a friend");
  expect(whatsapp).toContain("*bold* and _italic_");
});

test("buildChatSystemPrompt adds group chat guidance for telegram", () => {
  const prompt = buildChatSystemPrompt([], { channel: "telegram", chatKind: "group" });

  expect(prompt).toContain("Telegram group chat");
  expect(prompt).toContain("Everyone in the group");
  expect(prompt).toContain("plain text only");
});
