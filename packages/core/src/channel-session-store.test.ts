import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChannelSessionStore } from "./channel-session-store";

describe("ChannelSessionStore hot session cache", () => {
  test("clears hot session when persisted sessionId changes or deleted", () => {
    const store = new ChannelSessionStore("unused");
    const session = { id: "session_a" };
    store.set("chat_1", {
      profileId: "default",
      sessionId: "session_a",
      updatedAt: new Date().toISOString(),
    });
    store.setHotSession("chat_1", session);

    expect(store.getHotSession("chat_1")).toBe(session);

    store.set("chat_1", {
      profileId: "default",
      sessionId: "session_b",
      updatedAt: new Date().toISOString(),
    });
    expect(store.getHotSession("chat_1")).toBeUndefined();

    store.setHotSession("chat_1", { id: "session_b" });
    store.delete("chat_1");
    expect(store.getHotSession("chat_1")).toBeUndefined();
  });

  test("load clears hot sessions without touching persisted map", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nakama-session-store-"));
    const filePath = path.join(dir, "chat-sessions.json");
    try {
      const store = new ChannelSessionStore(filePath);
      store.set("chat_1", {
        profileId: "default",
        sessionId: "session_a",
        updatedAt: new Date().toISOString(),
      });
      await store.save();
      store.setHotSession("chat_1", { id: "session_a" });

      const reloaded = new ChannelSessionStore(filePath);
      await reloaded.load();
      expect(reloaded.get("chat_1")?.sessionId).toBe("session_a");
      expect(reloaded.getHotSession("chat_1")).toBeUndefined();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("concurrent saves do not roll back another conversation's state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nakama-session-store-"));
    const filePath = path.join(dir, "chat-sessions.json");
    try {
      const store = new ChannelSessionStore(filePath);
      store.set("chat_a", {
        profileId: "default",
        sessionId: "session_a",
        updatedAt: new Date().toISOString(),
      });
      store.set("chat_b", {
        profileId: "default",
        sessionId: "session_b",
        updatedAt: new Date().toISOString(),
      });

      // Both conversations are live and each saves the whole shared file. The
      // last write must contain both, not just whichever save finished last.
      await Promise.all([store.save(), store.save()]);

      const reloaded = new ChannelSessionStore(filePath);
      await reloaded.load();
      expect(reloaded.get("chat_a")?.sessionId).toBe("session_a");
      expect(reloaded.get("chat_b")?.sessionId).toBe("session_b");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
