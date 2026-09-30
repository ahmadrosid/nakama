import { NakamaApiError, NakamaClient } from "@nakama/client";
import {
  loadLocalAuthToken,
  rotateLocalAuthToken,
} from "@nakama/core/local-auth";
import { resolveServerUrl } from "@nakama/core/runtime";
import { runChat, runCleanupThenExit } from "./chat";
import {
  loadSavedCliServerUrl,
  saveCliServerUrl,
  setCliConfigScope,
} from "./cli-config";
import { isCliVerbose } from "./display-path";
import { parseCliOrgArgs, resolveCliOrgId } from "./org";
import { parseCliProfileArgs } from "./profile";
import {
  formatRotateTokenError,
  isRotateTokenCommand,
  runRotateToken,
} from "./rotate-token";
import {
  createRemoteConnection,
  ensureProviderConfiguredViaCli,
  ensureUserConfiguredViaCli,
  isLocalServer,
  normalizeServerUrl,
  parseConnectionArgs,
  promptRemoteLogin,
} from "./setup";
import { detectTheme, setTheme, type Theme } from "./styled-text";
import { InvalidThemeArgError, parseThemeArg } from "./theme-arg";

if (
  process.argv
    .slice(2)
    .some((arg) => ["--helper", "--help", "-h"].includes(arg))
) {
  console.log(`Usage: nakama [command] [options]

Commands:
  login                   Sign in and open chat
  logout                  Sign out of the selected server
  rotate-token            Rotate the local authentication token

Options:
  --server <url>          Connect to a server or prefill the login form
  --org <id|slug>         Choose the starting organization
  --theme <dark|light>    Choose the terminal theme
  --helper, --help, -h    Show this help

Examples:
  nakama login
  nakama login --server https://nakama.example.com
  nakama
  nakama logout

Without a command, start chat using the saved server.
In chat, use /org to list organizations or /org <slug> to switch.
Remote servers require HTTPS. Email and password are never saved.`);
  process.exit(0);
}

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

const abortController = new AbortController();

registerCleanupHandlers(async () => {
  abortController.abort();
});

const cliTheme = await resolveTheme();
setTheme(cliTheme);

try {
  const connectionArgs = parseConnectionArgs();
  if (
    connectionArgs.command === "login" &&
    !(process.stdin.isTTY && process.stdout.isTTY)
  ) {
    throw new Error("Login requires an interactive terminal.");
  }
  let serverUrl = normalizeServerUrl(
    connectionArgs.serverUrl ??
      (process.env.NAKAMA_SERVER_URL?.trim() || undefined) ??
      (await loadSavedCliServerUrl()) ??
      resolveServerUrl()
  );
  const remote = !isLocalServer(serverUrl);
  let client: NakamaClient;
  if (remote) {
    const connection = await createRemoteConnection(serverUrl);
    client = connection.client;
    if (connectionArgs.command === "logout") {
      await connection.logout();
      console.log("Logged out.");
      process.exit(0);
    }
    const login = () =>
      promptRemoteLogin(
        serverUrl,
        async (url, email, password, signal) => {
          const target =
            normalizeServerUrl(url) === serverUrl
              ? connection
              : await createRemoteConnection(url);
          signal?.throwIfAborted();
          await target.logout();
          signal?.throwIfAborted();
          await target.login(email, password, signal);
          serverUrl = url;
          client = target.client;
        },
        abortController.signal
      );
    if (connectionArgs.command === "login") {
      await login();
    }
    let user;
    try {
      user = await client.getMe();
    } catch (error) {
      if (!(error instanceof NakamaApiError && error.status === 401)) {
        throw error;
      }
      await login();
      user = await client.getMe();
    }
    await saveCliServerUrl(serverUrl);
    setCliConfigScope(serverUrl, user.id);
  } else {
    if (connectionArgs.command === "logout") {
      await rotateLocalAuthToken();
      console.log("Logged out.");
      process.exit(0);
    }
    client = new NakamaClient({
      authToken: (await loadLocalAuthToken("cli@nakama.internal")) ?? undefined,
      baseUrl: serverUrl,
    });
  }

  const cliOrg = parseCliOrgArgs();
  await resolveCliOrgId(client, cliOrg);

  let health = await client.health();

  if (!(remote || health.userConfigured)) {
    const created = await ensureUserConfiguredViaCli(client);

    if (created) {
      health = await client.health();
    }
  }

  if (!(remote || health.providerConfigured)) {
    const configured = await ensureProviderConfiguredViaCli(client);

    if (configured) {
      health = await client.health();
    }
  }

  const cliProfile = parseCliProfileArgs();

  await runChat({
    channel: "cli",
    client,
    codingWorkspaceRoot: remote ? undefined : process.cwd(),
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
