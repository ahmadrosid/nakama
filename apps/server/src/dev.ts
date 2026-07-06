import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_PORT, clearRuntimeServerUrl } from "@nakama/core";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const serverEntry = join(projectRoot, "apps/server/src/index.ts");

await killListenersOnPort(DEFAULT_SERVER_PORT);
clearRuntimeServerUrl();

const child = Bun.spawn(
  [
    "bun",
    "--watch",
    serverEntry,
    join(projectRoot, "packages/core/src"),
    join(projectRoot, "packages/db/src"),
    join(projectRoot, "packages/agent/src"),
  ],
  {
  cwd: projectRoot,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: process.env,
  },
);

const exitCode = await child.exited;
process.exit(exitCode ?? 0);

async function killListenersOnPort(port: number): Promise<void> {
  try {
    const result = Bun.spawnSync(["lsof", "-ti", `:${port}`]);
    const output = result.stdout.toString().trim();

    if (!output) {
      return;
    }

    for (const pid of output.split("\n")) {
      const numericPid = Number(pid);

      if (!Number.isFinite(numericPid)) {
        continue;
      }

      try {
        process.kill(numericPid, "SIGTERM");
      } catch {
        // Process may already be gone.
      }
    }

    await Bun.sleep(300);
  } catch {
    // lsof returns non-zero when nothing is listening.
  }
}
