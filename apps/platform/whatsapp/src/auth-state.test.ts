import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usePrivateMultiFileAuthState } from "./auth-state";

const POSIX = process.platform !== "win32";
const temporaryDirectories: string[] = [];
const PRE_KEY = {
  private: Buffer.from([1, 2, 3]),
  public: Buffer.from([4, 5, 6]),
};

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "nakama-whatsapp-auth-state-")
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function modeOf(path: string): Promise<number> {
  // biome-ignore lint/suspicious/noBitwiseOperators: permission bits are stored in st_mode.
  return (await stat(path)).mode & 0o777;
}

async function readAfter(path: string, delayMs: number): Promise<Buffer> {
  await Bun.sleep(delayMs);
  return readFile(path);
}

describe("private WhatsApp auth state", () => {
  test.skipIf(!POSIX)(
    "creates fresh credentials and Signal keys privately",
    async () => {
      const root = await createTemporaryDirectory();
      const authDirectory = join(root, "auth");
      const { saveCreds, state } =
        await usePrivateMultiFileAuthState(authDirectory);

      await saveCreds();
      await state.keys.set({ "pre-key": { "1": PRE_KEY } });

      expect(await modeOf(authDirectory)).toBe(0o700);
      expect(await modeOf(join(authDirectory, "creds.json"))).toBe(0o600);
      expect(await modeOf(join(authDirectory, "pre-key-1.json"))).toBe(0o600);
    }
  );

  test.skipIf(!POSIX)(
    "repairs existing loose permissions during startup",
    async () => {
      const root = await createTemporaryDirectory();
      const authDirectory = join(root, "auth");
      const existingFile = join(authDirectory, "existing.json");
      await mkdir(authDirectory, { mode: 0o755 });
      await writeFile(existingFile, "{}", { mode: 0o644 });
      await chmod(authDirectory, 0o755);
      await chmod(existingFile, 0o644);

      await usePrivateMultiFileAuthState(authDirectory);

      expect(await modeOf(authDirectory)).toBe(0o700);
      expect(await modeOf(existingFile)).toBe(0o600);
    }
  );

  test.skipIf(!POSIX)(
    "repairs credentials and Signal keys after every rewrite",
    async () => {
      const root = await createTemporaryDirectory();
      const authDirectory = join(root, "auth");
      const credentialsPath = join(authDirectory, "creds.json");
      const keyPath = join(authDirectory, "pre-key-1.json");
      const { saveCreds, state } =
        await usePrivateMultiFileAuthState(authDirectory);
      await saveCreds();
      await state.keys.set({ "pre-key": { "1": PRE_KEY } });
      await chmod(authDirectory, 0o755);
      await chmod(credentialsPath, 0o644);
      await chmod(keyPath, 0o644);

      await saveCreds();
      await state.keys.set({ "pre-key": { "1": PRE_KEY } });

      expect(await modeOf(authDirectory)).toBe(0o700);
      expect(await modeOf(credentialsPath)).toBe(0o600);
      expect(await modeOf(keyPath)).toBe(0o600);
    }
  );

  test.skipIf(!POSIX)(
    "secures sibling writes and recovers after a batch fails",
    async () => {
      const root = await createTemporaryDirectory();
      const authDirectory = join(root, "auth");
      const persistedPath = join(authDirectory, "session-persisted.json");
      const recoveredPath = join(authDirectory, "session-recovered.json");
      const { state } = await usePrivateMultiFileAuthState(authDirectory);
      const invalidId = "x".repeat(300);

      await expect(
        state.keys.set({
          session: {
            [invalidId]: Uint8Array.from([1]),
            persisted: Uint8Array.from([9]),
          },
        })
      ).rejects.toThrow();

      expect(await modeOf(authDirectory)).toBe(0o700);
      expect(await modeOf(persistedPath)).toBe(0o600);

      await state.keys.set({
        session: { recovered: Uint8Array.from([2]) },
      });
      expect(await modeOf(recoveredPath)).toBe(0o600);
    }
  );

  test.skipIf(!POSIX)(
    "waits for a queued key write before returning a batch failure",
    async () => {
      const root = await createTemporaryDirectory();
      const authDirectory = join(root, "auth");
      const { state } = await usePrivateMultiFileAuthState(authDirectory);
      const invalidId = "x".repeat(300);
      const persistedPath = join(authDirectory, "session-persisted.json");
      const mkfifo = Bun.spawn(["mkfifo", persistedPath], {
        stderr: "pipe",
        stdout: "ignore",
      });
      expect(await mkfifo.exited).toBe(0);

      let secondReaderStarted = false;
      const firstRead = readAfter(persistedPath, 50);
      const secondRead = (async () => {
        await Bun.sleep(100);
        secondReaderStarted = true;
        return readFile(persistedPath);
      })();

      const precedingWrite = Promise.resolve(
        state.keys.set({ session: { persisted: Uint8Array.from([7]) } })
      );
      const failedBatch = Promise.resolve(
        state.keys.set({
          session: {
            [invalidId]: Uint8Array.from([1]),
            persisted: Uint8Array.from([9]),
          },
        })
      );

      try {
        await expect(failedBatch).rejects.toThrow();
        expect(secondReaderStarted).toBe(true);
      } finally {
        await precedingWrite;
        await Promise.all([firstRead, secondRead]);
      }
    }
  );

  test("stale state cannot recreate an auth directory deleted for reconnect", async () => {
    const root = await createTemporaryDirectory();
    const authDirectory = join(root, "auth");
    const stale = await usePrivateMultiFileAuthState(authDirectory);
    await stale.saveCreds();
    await rm(authDirectory, { force: true, recursive: true });

    await expect(stale.saveCreds()).rejects.toThrow();
    await expect(
      stale.state.keys.set({ "pre-key": { stale: PRE_KEY } })
    ).rejects.toThrow();
    await expect(stat(authDirectory)).rejects.toThrow();

    const fresh = await usePrivateMultiFileAuthState(authDirectory);
    await fresh.saveCreds();
    expect((await stat(join(authDirectory, "creds.json"))).isFile()).toBe(true);
  });
});
