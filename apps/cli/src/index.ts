import { createClient } from "@tinyclaw/client";
import { runChat } from "./chat";
import { ensureServerRunning, stopSpawnedServer } from "@tinyclaw/core/ensure-server";

let spawnedChild: Bun.Subprocess | null = null;

registerCleanupHandlers(() => stopSpawnedServer(spawnedChild));

try {
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = createClient({ baseUrl: serverUrl });
  const health = await client.health();

  await runChat({ client, channel: "cli", offline: !health.providerConfigured });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);

  if (message === "Not found") {
    console.error(
      "\nThe server looks outdated. Restart it to pick up the latest API:\n  bun run dev:server\n",
    );
  }

  process.exit(1);
} finally {
  stopSpawnedServer(spawnedChild);
}

process.exit(0);

function registerCleanupHandlers(cleanup: () => void): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      process.exit(0);
    });
  }
}
