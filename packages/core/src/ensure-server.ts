import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TINYCLAW_API_VERSION } from "./contract";
import { resolveServerUrl } from "./runtime";

const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

export interface EnsureServerResult {
  serverUrl: string;
  spawnedChild: Bun.Subprocess | null;
}

export async function ensureServerRunning(): Promise<EnsureServerResult> {
  const serverUrl = resolveServerUrl();

  if (await isServerHealthy(serverUrl)) {
    return { serverUrl, spawnedChild: null };
  }

  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const serverEntry = join(projectRoot, "apps/server/src/index.ts");
  const child = Bun.spawn(["bun", "run", serverEntry], {
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
    env: process.env,
  });

  console.warn("Starting TinyClaw server...");

  const readyUrl = await waitForServer(STARTUP_TIMEOUT_MS);

  if (!readyUrl) {
    stopSpawnedServer(child);
    throw new Error(`Server failed to start within ${STARTUP_TIMEOUT_MS / 1000}s (${serverUrl})`);
  }

  if (child.exitCode !== null) {
    return { serverUrl: readyUrl, spawnedChild: null };
  }

  return { serverUrl: readyUrl, spawnedChild: child };
}

export function stopSpawnedServer(child: Bun.Subprocess | null): void {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill();
}

const REQUIRED_BUILTIN_TOOLS = [
  "write_file",
  "delete_file",
  "edit_file",
  "read_file",
  "search_files",
  "web_search",
] as const;

export async function serverHasTaskChat(
  serverUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/v1/tasks/__capability_probe__/messages`, {
      signal,
    });

    if (response.status !== 404) {
      return false;
    }

    const payload = (await response.json()) as { error?: string };
    return payload.error === "Task not found.";
  } catch {
    return false;
  }
}

async function isServerHealthy(serverUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 800);

  try {
    const response = await fetch(`${serverUrl}/health`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as {
      ok?: boolean;
      apiVersion?: number;
    };

    if (payload.ok !== true || payload.apiVersion !== TINYCLAW_API_VERSION) {
      return false;
    }

    if (!(await serverHasTaskChat(serverUrl, controller.signal))) {
      return false;
    }

    const toolsResponse = await fetch(`${serverUrl}/v1/tools`, {
      signal: controller.signal,
    });

    if (!toolsResponse.ok) {
      return false;
    }

    const toolsPayload = (await toolsResponse.json()) as {
      tools?: Array<{ name?: string }>;
    };
    const toolNames = new Set(
      (toolsPayload.tools ?? [])
        .map((tool) => tool.name)
        .filter((name): name is string => typeof name === "string"),
    );

    return REQUIRED_BUILTIN_TOOLS.every((name) => toolNames.has(name));
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForServer(timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const serverUrl = resolveServerUrl();

    if (await isServerHealthy(serverUrl)) {
      return serverUrl;
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }

  return null;
}
