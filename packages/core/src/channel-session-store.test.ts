import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChannelSessionStore } from "./channel-session-store";

async function withStore(
  run: (store: ChannelSessionStore, filePath: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "nakama-session-store-"));
  const filePath = path.join(dir, "chat-sessions.json");
  try {
    const store = new ChannelSessionStore(filePath);
    await store.load();
    await run(store, filePath);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe("ChannelSessionStore hot session cache", () => {
  test("returns hot session only when sessionId matches", async () => {
    await withStore(async (store) => {
      const session = { id: "session_a" };
      store.set("chat_1", {
        profileId: "default",
        sessionId: "session_a",
        updatedAt: new Date().toISOString(),
      });
      store.setHotSession("chat_1", "session_a", session);

      expect(store.getHotSession("chat_1", "session_a")).toBe(session);
      expect(store.getHotSession("chat_1", "session_other")).toBeUndefined();
      expect(store.getHotSession("missing", "session_a")).toBeUndefined();
    });
  });

  test("clears hot session when persisted sessionId changes or deleted", async () => {
    await withStore(async (store) => {
      const session = { id: "session_a" };
      store.set("chat_1", {
        profileId: "default",
        sessionId: "session_a",
        updatedAt: new Date().toISOString(),
      });
      store.setHotSession("chat_1", "session_a", session);

      store.set("chat_1", {
        profileId: "default",
        sessionId: "session_b",
        updatedAt: new Date().toISOString(),
      });
      expect(store.getHotSession("chat_1", "session_a")).toBeUndefined();
      expect(store.getHotSession("chat_1", "session_b")).toBeUndefined();

      store.setHotSession("chat_1", "session_b", { id: "session_b" });
      store.delete("chat_1");
      expect(store.getHotSession("chat_1", "session_b")).toBeUndefined();
    });
  });

  test("load clears hot sessions without touching persisted map", async () => {
    await withStore(async (store, filePath) => {
      store.set("chat_1", {
        profileId: "default",
        sessionId: "session_a",
        updatedAt: new Date().toISOString(),
      });
      await store.save();
      store.setHotSession("chat_1", "session_a", { id: "session_a" });

      const reloaded = new ChannelSessionStore(filePath);
      await reloaded.load();
      expect(reloaded.get("chat_1")?.sessionId).toBe("session_a");
      expect(reloaded.getHotSession("chat_1", "session_a")).toBeUndefined();
    });
  });
});
