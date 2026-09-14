import { afterAll, expect, mock, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("electron", () => ({
  app: {},
  BrowserWindow: {},
  dialog: {},
  Menu: {},
  nativeTheme: {},
  shell: {},
}));
process.argv.push("--smoke-test");
const { startLocalServer } = await import("../main.mjs");
process.argv.pop();

const root = await mkdtemp(join(tmpdir(), "nakama-desktop-runtime-"));
afterAll(() => rm(root, { force: true, recursive: true }));

test("stopping the local server disconnects IPC and waits for cleanup", async () => {
  const runtime = join(root, "runtime");
  const data = join(root, "data");
  await mkdir(join(runtime, "bin"), { recursive: true });
  await mkdir(join(runtime, "apps/server/src"), { recursive: true });
  await cp(
    process.execPath,
    join(runtime, "bin", process.platform === "win32" ? "bun.exe" : "bun")
  );
  await writeFile(
    join(runtime, "apps/server/src/index.ts"),
    `
    import { join } from 'node:path';
    process.on('disconnect', async () => {
      await Bun.sleep(50);
      await Bun.write(join(process.env.NAKAMA_CONFIG_DIR, 'cleaned'), 'yes');
      process.exit(0);
    });
    process.send({ type: 'nakama-ready', url: 'http://127.0.0.1:12345' });
    setInterval(() => {}, 1000);
  `
  );
  const local = await startLocalServer(runtime, data);
  try {
    expect(local.url).toBe("http://127.0.0.1:12345");
    await local.stop();
    expect(await readFile(join(data, "cleaned"), "utf8")).toBe("yes");
    expect(local.child.exitCode).toBe(0);
    await local.stop();
  } finally {
    local.child.kill();
  }
});

test("a missing runtime rejects instead of hanging", async () => {
  await expect(
    startLocalServer(join(root, "missing"), join(root, "missing-data"))
  ).rejects.toThrow();
});
