import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { AgentService } from "./services/agent-service";
import { ensureProviderConfigured } from "./setup";
import { TINYCLAW_API_VERSION } from "@tinyclaw/core";
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  clearRuntimeServerUrl,
  loadConfig,
  writeRuntimeServerUrl,
} from "@tinyclaw/core";
import { createDatabase, seedDatabase, type Database } from "@tinyclaw/db";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const host = process.env.TINYCLAW_HOST ?? DEFAULT_SERVER_HOST;
const requestedPort = parsePort(process.env.TINYCLAW_PORT);
const canFallbackToNextPort = process.env.TINYCLAW_PORT == null;

const existingServerUrl = await findRunningTinyClawServerUrl(host, requestedPort);

if (existingServerUrl) {
  const runtimeServerUrl = writeRuntimeServerUrl(existingServerUrl);
  console.log(`TinyClaw server already running on ${runtimeServerUrl}`);
  process.exit(0);
}

const { provider, userConfig } = await ensureProviderConfigured();
const config = loadConfig();
const database = await createDatabase(config.databaseUrl, { baseDir: projectRoot });

await seedDatabase(database.adapter);

const agent = new AgentService(userConfig, provider, database.adapter);
const app = createApp({ agent });

const server = startServer({
  host,
  preferredPort: requestedPort,
  canFallbackToNextPort,
  fetch: app.fetch,
});
const serverUrl = writeRuntimeServerUrl(
  `http://${server.hostname}:${server.port}`,
);

registerRuntimeCleanup(server, serverUrl, database);

if (server.port !== requestedPort) {
  console.log(`Port ${requestedPort} is busy. Using ${server.port} instead.`);
}

console.log(`TinyClaw server listening on ${serverUrl}`);
console.log(`TinyClaw database ready at ${config.databaseUrl}`);

if (!provider) {
  console.log("Provider not configured. Chat will run in offline mode.");
}

function parsePort(value: string | undefined): number {
  if (!value?.trim()) {
    return DEFAULT_SERVER_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid TINYCLAW_PORT: ${value}`);
  }

  return port;
}

function startServer(options: {
  host: string;
  preferredPort: number;
  canFallbackToNextPort: boolean;
  fetch: (request: Request) => Promise<Response>;
}): ReturnType<typeof Bun.serve> {
  const lastPort = options.canFallbackToNextPort
    ? Math.min(options.preferredPort + 2000, 65535)
    : options.preferredPort;
  let lastError: unknown;

  for (let port = options.preferredPort; port <= lastPort; port += 1) {

    try {
      return Bun.serve({
        hostname: options.host,
        port,
        fetch: options.fetch,
      });
    } catch (error) {
      if (!isAddressInUseError(error) || !options.canFallbackToNextPort) {
        throw error;
      }

      lastError = error;
    }
  }

  throw lastError ?? new Error("Failed to find an open port for the TinyClaw server.");
}

function isAddressInUseError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
}

function registerRuntimeCleanup(
  server: ReturnType<typeof Bun.serve>,
  serverUrl: string,
  database: Database,
): void {
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    clearRuntimeServerUrl(serverUrl);
    database.close();
  };

  process.on("exit", cleanup);

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      cleanup();
      server.stop(true);
      process.exit(0);
    });
  }
}

async function findRunningTinyClawServerUrl(
  host: string,
  port: number,
): Promise<string | null> {
  const serverUrl = `http://${normalizeHealthCheckHost(host)}:${port}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 400);

  try {
    const response = await fetch(`${serverUrl}/health`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      ok?: boolean;
      apiVersion?: number;
    };
    return payload.ok === true && payload.apiVersion === TINYCLAW_API_VERSION
      ? serverUrl
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeHealthCheckHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return DEFAULT_SERVER_HOST;
  }

  return host;
}
