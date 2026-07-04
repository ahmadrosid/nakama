import { createClient } from "@tinyclaw/client";
import { loadLocalAuthToken } from "@tinyclaw/core/local-auth";
import { runChat } from "./chat";
import { parseCliProfileArgs } from "./profile";
import { ensureUserConfiguredViaCli, ensureProviderConfiguredViaCli } from "./setup";
import { ensureServerRunning, stopSpawnedServer } from "@tinyclaw/core/ensure-server";
import { setTheme, type Theme, detectTheme } from "./styled-text";
import {
  formatRotateTokenError,
  isRotateTokenCommand,
  runRotateToken,
} from "./rotate-token";

if (isRotateTokenCommand()) {
  try {
    await runRotateToken();
    process.exit(0);
  } catch (error) {
    console.error(formatRotateTokenError(error));
    process.exit(1);
  }
}

function parseThemeArg(argv = process.argv.slice(2)): Theme | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--theme") {
      const value = argv[index + 1]?.trim();
      if (value === "light" || value === "dark") return value;
      index += 1;
      continue;
    }

    if (arg === "--theme=light") return "light";
    if (arg === "--theme=dark") return "dark";
  }

  return null;
}

async function resolveTheme(): Promise<Theme> {
  const explicit = parseThemeArg();
  if (explicit) return explicit;
  if (process.env.TINYCLAW_THEME === "light") return "light";
  if (process.env.TINYCLAW_THEME === "dark") return "dark";
  const detected = await detectTheme();
  return detected ?? "dark";
}

let spawnedChild: Bun.Subprocess | null = null;
const abortController = new AbortController();

registerCleanupHandlers(() => {
  abortController.abort();
  stopSpawnedServer(spawnedChild);
});

const cliTheme = await resolveTheme();
setTheme(cliTheme);

try {
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = createClient({
    baseUrl: serverUrl,
    authToken: await loadLocalAuthToken("cli@tinyclaw.internal"),
  });
  let health = await client.health();

  if (!health.userConfigured) {
    const created = await ensureUserConfiguredViaCli(client);

    if (created) {
      health = await client.health();
    }
  }

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
    signal: abortController.signal,
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
