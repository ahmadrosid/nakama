import { createClient } from "@tinyclaw/client";
import { runChat } from "./chat";
import { parseCliProfileArgs } from "./profile";
import { ensureProviderConfiguredViaCli } from "./setup";
import { ensureServerRunning, stopSpawnedServer } from "@tinyclaw/core/ensure-server";

let spawnedChild: Bun.Subprocess | null = null;

registerCleanupHandlers(() => stopSpawnedServer(spawnedChild));

try {
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = createClient({ baseUrl: serverUrl });
  let health = await client.health();

  if (!health.providerConfigured) {
    const configured = await ensureProviderConfiguredViaCli(client);

    if (configured) {
      health = await client.health();
    }
  }

  const cliProfile = parseCliProfileArgs();

  await runChat({
    client,
    channel: "cli",
    offline: !health.providerConfigured,
    profileId: cliProfile.profileId,
  });
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
