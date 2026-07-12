import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_PORT, clearRuntimeServerUrl } from "@nakama/core";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const serverEntry = join(projectRoot, "apps/server/src/index.ts");

await killListenersOnPort(DEFAULT_SERVER_PORT);
clearRuntimeServerUrl();

const child = Bun.spawn(["bun", "run", serverEntry], {
  cwd: projectRoot,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: {
    ...process.env,
    NAKAMA_INFERENCE_GATEWAY_ENABLED:
      process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED ?? "1",
  },
});

process.exit((await child.exited) ?? 0);

async function killListenersOnPort(port: number): Promise<void> {
  try {
    const output = Bun.spawnSync(["lsof", "-ti", `:${port}`]).stdout.toString().trim();
    if (!output) {
      return;
    }

    for (const id of output.split("\n").map(Number).filter((n) => n > 0)) {
      try {
        process.kill(id, "SIGTERM");
      } catch {
        // Process may already be gone.
      }
    }

    await Bun.sleep(300);
  } catch {
    // lsof returns non-zero when nothing is listening.
  }
}
