import path from "node:path";
import { describe, expect, test } from "bun:test";
import { ThreadStore } from "./thread-store";
import { withTempHome } from "./test-helpers";

describe("ThreadStore multi-thread ownership", () => {
  test("loads legacy string mappings and keeps older threads when adding", async () => {
    await withTempHome(async (homeDir) => {
      const storePath = path.join(homeDir, ".nakama", "discord", "chat-threads.json");
      await Bun.write(
        storePath,
        `${JSON.stringify({ "g:channel_1:u:user_1": "thread_old" }, null, 2)}\n`,
      );

      const store = new ThreadStore(storePath);
      await store.load();

      expect(store.get("g:channel_1:u:user_1")).toBe("thread_old");
      expect(store.hasThreadId("thread_old")).toBe(true);

      store.add("g:channel_1:u:user_1", "thread_new");
      await store.save();

      expect(store.list("g:channel_1:u:user_1")).toEqual(["thread_old", "thread_new"]);
      expect(store.get("g:channel_1:u:user_1")).toBe("thread_new");
      expect(store.hasThreadId("thread_old")).toBe(true);
      expect(store.hasThreadId("thread_new")).toBe(true);

      const reloaded = new ThreadStore(storePath);
      await reloaded.load();
      expect(reloaded.list("g:channel_1:u:user_1")).toEqual(["thread_old", "thread_new"]);
    });
  });

  test("deleteByThreadId removes one thread without dropping siblings", async () => {
    await withTempHome(async (homeDir) => {
      const store = new ThreadStore(
        path.join(homeDir, ".nakama", "discord", "chat-threads.json"),
      );
      await store.load();

      store.add("g:channel_1:u:user_1", "thread_a");
      store.add("g:channel_1:u:user_1", "thread_b");
      expect(store.deleteByThreadId("thread_a")).toBe(true);
      expect(store.list("g:channel_1:u:user_1")).toEqual(["thread_b"]);
      expect(store.hasThreadId("thread_a")).toBe(false);
      expect(store.hasThreadId("thread_b")).toBe(true);
    });
  });
});
