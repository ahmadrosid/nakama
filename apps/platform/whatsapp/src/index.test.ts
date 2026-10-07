import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lifecycleModuleUrl = new URL("./process-lifecycle.ts", import.meta.url)
  .href;

test("uncaught exception exits nonzero after cleanup", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "nakama-whatsapp-lifecycle-"));
  const cleanupMarker = join(tempDir, "cleaned");

  try {
    const script = `
      import { existsSync, writeFileSync } from "node:fs";
      import { registerProcessLifecycleHandlers } from ${JSON.stringify(lifecycleModuleUrl)};

      registerProcessLifecycleHandlers(() => {
        writeFileSync(${JSON.stringify(cleanupMarker)}, "cleaned");
      });
      setImmediate(() => {
        if (!existsSync(${JSON.stringify(cleanupMarker)})) {
          process.exit(0);
        }
      });
      setInterval(() => undefined, 1_000);
      queueMicrotask(() => {
        throw new Error("fatal worker failure");
      });
    `;
    const child = Bun.spawn({
      cmd: [process.execPath, "--no-install", "-e", script],
      stderr: "ignore",
      stdout: "ignore",
    });

    expect(await child.exited).toBe(1);
    expect(await readFile(cleanupMarker, "utf8")).toBe("cleaned");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
