import { NakamaClient } from "@nakama/client";
import {
  ensureServerRunning,
  stopSpawnedServer,
} from "@nakama/core/ensure-server";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { runChat, runCleanupThenExit } from "./chat";
import { isCliVerbose } from "./display-path";
import { parseCliOrgArgs, resolveCliOrgId } from "./org";
import { parseCliProfileArgs } from "./profile";
import {
  formatRotateTokenError,
  isRotateTokenCommand,
  runRotateToken,
} from "./rotate-token";
import {
  ensureProviderConfiguredViaCli,
  ensureUserConfiguredViaCli,
} from "./setup";
import { detectTheme, setTheme, type Theme } from "./styled-text";
import { InvalidThemeArgError, parseThemeArg } from "./theme-arg";

if (isRotateTokenCommand()) {
  try {
    await runRotateToken();
    process.exit(0);
  } catch (error) {
    console.error(formatRotateTokenError(error));
    process.exit(1);
  }
}

async function resolveTheme(): Promise<Theme> {
  try {
    const explicit = parseThemeArg();
    if (explicit) {
      return explicit;
    }
  } catch (error) {
    if (error instanceof InvalidThemeArgError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  if (process.env.NAKAMA_THEME === "light") {
    return "light";
  }
  if (process.env.NAKAMA_THEME === "dark") {
    return "dark";
  }
  const detected = await detectTheme();
  return detected ?? "dark";
}

let spawnedChild: Bun.Subprocess | null = null;
const abortController = new AbortController();

registerCleanupHandlers(async () => {
  abortController.abort();
  stopSpawnedServer(spawnedChild);
});

const cliTheme = await resolveTheme();
setTheme(cliTheme);

try {
  const { serverUrl, spawnedChild: child } = await ensureServerRunning();
  spawnedChild = child;

  const client = new NakamaClient({
    authToken: await loadLocalAuthToken("cli@nakama.internal"),
    baseUrl: serverUrl,
  });

  const cliOrg = parseCliOrgArgs();
  await resolveCliOrgId(client, cliOrg);

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
    channel: "cli",
    client,
    offline: !health.providerConfigured,
    profileId: cliProfile.profileId,
    signal: abortController.signal,
    verbose: isCliVerbose(),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);

  if (message === "Not found") {
    console.error(
      "\nThe server looks outdated. Restart it to pick up the latest API:\n  bun run dev:server\n"
    );
  }

  process.exit(1);
} finally {
  stopSpawnedServer(spawnedChild);
}

process.exit(0);

function registerCleanupHandlers(cleanup: () => void | Promise<void>): void {
  let exiting = false;

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (exiting) {
        return;
      }

      exiting = true;
      void runCleanupThenExit(cleanup);
    });
  }
}
