import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usePrivateMultiFileAuthState } from "./auth-state";

const POSIX = process.platform !== "win32";
const temporaryDirectories: string[] = [];
const PRE_KEY = {
  private: Buffer.from([1, 2, 3]),
  public: Buffer.from([4, 5, 6]),
};
let previousUmask: number | null = null;

beforeEach(() => {
  if (POSIX) {
    previousUmask = process.umask(0o022);
  }
});

afterEach(async () => {
  if (previousUmask !== null) {
    process.umask(previousUmask);
    previousUmask = null;
  }
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

      expect(process.umask()).toBe(0o077);
      expect(await modeOf(authDirectory)).toBe(0o700);
      expect(await modeOf(join(authDirectory, "creds.json"))).toBe(0o600);
      expect(await modeOf(join(authDirectory, "pre-key-1.json"))).toBe(0o600);
    }
  );

  test.skipIf(!POSIX)(
    "preserves a stricter existing process umask",
    async () => {
      const root = await createTemporaryDirectory();
      const authDirectory = join(root, "auth");
      process.umask(0o177);

      const { saveCreds } = await usePrivateMultiFileAuthState(authDirectory);
      await saveCreds();

      expect(process.umask()).toBe(0o177);
      expect(await modeOf(authDirectory)).toBe(0o700);
      expect(await modeOf(join(authDirectory, "creds.json"))).toBe(0o600);
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
    "keeps credentials private across resave and reconnect",
    async () => {
      const root = await createTemporaryDirectory();
      const authDirectory = join(root, "auth");
      const credentialsPath = join(authDirectory, "creds.json");
      const keyPath = join(authDirectory, "pre-key-1.json");
      const { saveCreds, state } =
        await usePrivateMultiFileAuthState(authDirectory);
      await saveCreds();
      await state.keys.set({ "pre-key": { "1": PRE_KEY } });

      expect(await modeOf(authDirectory)).toBe(0o700);
      expect(await modeOf(credentialsPath)).toBe(0o600);
      expect(await modeOf(keyPath)).toBe(0o600);

      await saveCreds();
      await state.keys.set({ "pre-key": { "1": PRE_KEY } });

      expect(await modeOf(authDirectory)).toBe(0o700);
      expect(await modeOf(credentialsPath)).toBe(0o600);
      expect(await modeOf(keyPath)).toBe(0o600);

      const reconnected = await usePrivateMultiFileAuthState(authDirectory);
      await reconnected.saveCreds();
      await reconnected.state.keys.set({ "pre-key": { "1": PRE_KEY } });

      expect(await modeOf(authDirectory)).toBe(0o700);
      expect(await modeOf(credentialsPath)).toBe(0o600);
      expect(await modeOf(keyPath)).toBe(0o600);
    }
  );
});
