import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureServerRunning, stopSpawnedServer } from "@nakama/core/ensure-server";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let spawnedServer: Bun.Subprocess | null = null;
let viteProcess: Bun.Subprocess | null = null;

registerCleanupHandlers(() => {
  stopSpawnedServer(spawnedServer);
  stopProcess(viteProcess);
});

try {
  const { serverUrl, spawnedChild } = await ensureServerRunning();
  spawnedServer = spawnedChild;

  viteProcess = Bun.spawn(["bun", "run", "vite"], {
    cwd: webRoot,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: {
      ...process.env,
      TINYCLAW_SERVER_URL: serverUrl,
    },
  });

  const exitCode = await viteProcess.exited;
  process.exit(exitCode ?? 0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
} finally {
  stopSpawnedServer(spawnedServer);
  stopProcess(viteProcess);
}

function stopProcess(child: Bun.Subprocess | null): void {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill();
}

function registerCleanupHandlers(cleanup: () => void): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
}
