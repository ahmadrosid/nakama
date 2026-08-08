import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { withTempHome } from "./test-helpers";
import { ThreadStore } from "./thread-store";

describe("ThreadStore ownership", () => {
  test("tracks multiple owned thread ids independently", async () => {
    await withTempHome(async (homeDir) => {
      const store = new ThreadStore(
        path.join(homeDir, ".nakama", "discord", "chat-threads.json")
      );
      await store.load();

      store.add("thread_a");
      store.add("thread_b");
      await store.save();

      expect(store.hasThreadId("thread_a")).toBe(true);
      expect(store.hasThreadId("thread_b")).toBe(true);

      expect(store.deleteByThreadId("thread_a")).toBe(true);
      await store.save();

      expect(store.hasThreadId("thread_a")).toBe(false);
      expect(store.hasThreadId("thread_b")).toBe(true);
    });
  });

  test("loads legacy lookup-map values as owned thread ids", async () => {
    await withTempHome(async (homeDir) => {
      const filePath = path.join(
        homeDir,
        ".nakama",
        "discord",
        "chat-threads.json"
      );
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        `${JSON.stringify({ "g:guild_channel_1:u:424242424242424242": "thread_old" }, null, 2)}\n`
      );

      const store = new ThreadStore(filePath);
      await store.load();

      expect(store.hasThreadId("thread_old")).toBe(true);
    });
  });

  test("loads non-object JSON as empty ownership", async () => {
    await withTempHome(async (homeDir) => {
      const filePath = path.join(
        homeDir,
        ".nakama",
        "discord",
        "chat-threads.json"
      );
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, "[]\n");

      const store = new ThreadStore(filePath);
      await store.load();

      expect(store.hasThreadId("thread_any")).toBe(false);
    });
  });
});
