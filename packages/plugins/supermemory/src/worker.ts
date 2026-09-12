import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

const VERSION = "0.0.8";
const CHECKSUMS: Record<string, string> = {
  "darwin-arm64":
    "12b7817a105ed0a9e70f96c461fb6f8dded5d70eaeb6034e774778c257bed78a",
  "darwin-x64":
    "2b50821fc2b0a952d1431fa5daf5af19a350748a82e1242a65c4a1e5cb453beb",
  "linux-arm64":
    "eeb9e62a8bf59646bd799a05d1a2981b945413a03640c3a39f4f267ad2d2bf37",
  "linux-x64":
    "87f32433d0179be80bb9d8a1bafbac65af4128324342a27ecb8bd1a77b5506f3",
};

export function providerEnvironment(config: {
  type: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}): Record<string, string> {
  if (!config) {
    throw new Error(
      "Configure an AI provider in Nakama Settings, then restart Supermemory in Workers."
    );
  }
  const key = config.apiKey?.trim();
  if (config.type === "anthropic" && key) {
    return { ANTHROPIC_API_KEY: key };
  }
  if (config.type === "gemini" && key) {
    return { GEMINI_API_KEY: key };
  }
  const baseUrls: Record<string, string> = {
    deepseek: "https://api.deepseek.com/v1",
    ollama: "http://localhost:11434/v1",
    openai: "https://api.openai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    together: "https://api.together.xyz/v1",
    xai: "https://api.x.ai/v1",
  };
  let baseUrl = (config.baseUrl || baseUrls[config.type])?.replace(/\/$/, "");
  if (config.type === "ollama" && baseUrl && !baseUrl.endsWith("/v1")) {
    baseUrl += "/v1";
  }
  if (
    (key || config.type === "ollama") &&
    baseUrl &&
    !["chatgpt", "xai_oauth", "cloudflare"].includes(config.type)
  ) {
    return {
      OPENAI_API_KEY: key || "ollama",
      OPENAI_BASE_URL: baseUrl.replace(/\/$/, ""),
      ...(config.model ? { OPENAI_MODEL: config.model } : {}),
    };
  }
  throw new Error(
    "Select an API-key or local AI provider in Nakama Settings, then restart Supermemory in Workers. Subscription sign-ins are not supported by the local Supermemory server."
  );
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function installServer(directory: string, signal?: AbortSignal) {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const platform = `${process.platform}-${process.arch}`;
  const expected = CHECKSUMS[platform];
  if (!expected) {
    throw new Error(
      "Supermemory local supports macOS and Linux on x64 or arm64"
    );
  }
  const path = join(directory, `supermemory-server-${VERSION}`);
  if ((await Bun.file(path).exists()) && (await sha256(path)) === expected) {
    await chmod(path, 0o700);
    return path;
  }
  const response = await fetch(
    `https://github.com/supermemoryai/supermemory/releases/download/server-v${VERSION}/supermemory-server-${platform}`,
    {
      signal: AbortSignal.any([
        AbortSignal.timeout(300_000),
        ...(signal ? [signal] : []),
      ]),
    }
  );
  if (!(response.ok && response.body)) {
    throw new Error(
      "Could not download Supermemory; restart the worker to retry"
    );
  }
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    const file = Bun.file(temporary).writer();
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 512 * 1024 * 1024) {
          throw new Error("Supermemory download exceeds size limit");
        }
        file.write(chunk);
      }
    } finally {
      await file.end();
    }
    if ((await sha256(temporary)) !== expected) {
      throw new Error("Supermemory download checksum mismatch");
    }
    await chmod(temporary, 0o700);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

async function runWorker(directory: string, pluginDataDir: string) {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const statusPath = join(directory, "status.json");
  const status = async (state: string, message?: string) => {
    await writeFile(statusPath + ".tmp", JSON.stringify({ message, state }), {
      mode: 0o600,
    });
    await rename(statusPath + ".tmp", statusPath);
  };
  await status("starting");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let stopping = false;
  const abort = new AbortController();
  const stop = () => {
    stopping = true;
    abort.abort();
    child?.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    // Existing externally hosted datasets retain their connection and storage.
    if (await Bun.file(join(pluginDataDir, "connection.json")).exists()) {
      await status("external");
      console.log("Using the existing external Supermemory connection.");
      while (!stopping) {
        await Bun.sleep(1000);
      }
      return;
    }
    const config = JSON.parse(
      await readFile(join(directory, "llm.json"), "utf8")
    );
    const provider = providerEnvironment(config);
    console.log("Preparing Supermemory server " + VERSION);
    const binary = await installServer(join(directory, "cache"), abort.signal);
    if (stopping) {
      return;
    }
    const store = join(directory, "data");
    const home = join(directory, "home");
    await mkdir(home, { mode: 0o700, recursive: true });
    await mkdir(store, { mode: 0o700, recursive: true });
    // Let the OS choose a free port; publish it only after authenticated readiness.
    const reservation = Bun.serve({
      fetch: () => new Response(),
      hostname: "127.0.0.1",
      port: 0,
    });
    const port = reservation.port!;
    await reservation.stop(true);
    const url = `http://127.0.0.1:${port}`;
    child = Bun.spawn([binary], {
      cwd: directory,
      env: {
        HOME: home,
        PATH: process.env.PATH,
        ...provider,
        PORT: String(port),
        SUPERMEMORY_DATA_DIR: store,
        SUPERMEMORY_DISABLE_TELEMETRY: "1",
        SUPERMEMORY_EMBEDDING_PROVIDER: "local",
        SUPERMEMORY_PORT: String(port),
        SUPERMEMORY_SKIP_EMBEDDING_PREWARM: "1",
      },
      stderr: "ignore",
      stdin: "ignore",
      // Upstream prints its bearer token at boot; keep it out of worker logs.
      stdout: "ignore",
    });
    const deadline = Date.now() + 180_000;
    let ready = false;
    while (
      !stopping &&
      child.exitCode === null &&
      child.signalCode === null &&
      Date.now() < deadline
    ) {
      try {
        const token = (await readFile(join(store, "api-key"), "utf8")).trim();
        if (!token) {
          throw new Error("Waiting for credentials");
        }
        const response = await fetch(url + "/v3/documents/list", {
          body: JSON.stringify({ limit: 1 }),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(2000),
        });
        await response.body?.cancel();
        if (response.ok) {
          const path = join(directory, "connection.json");
          await writeFile(path + ".tmp", JSON.stringify({ token, url }), {
            mode: 0o600,
          });
          await rename(path + ".tmp", path);
          ready = true;
          await status("ready");
          console.log("Supermemory is ready.");
          break;
        }
      } catch {
        /* Readiness is retried while the child starts. */
      }
      await Bun.sleep(500);
    }
    if (!(ready || stopping)) {
      throw new Error(
        "Supermemory did not become ready; check the configured AI provider and restart the worker"
      );
    }
    await child.exited;
    if (!stopping) {
      throw new Error("Supermemory exited; restart the worker to retry");
    }
  } catch (error) {
    if (stopping) {
      return;
    }
    const message =
      error instanceof Error ? error.message : "Supermemory could not start";
    await status("error", message);
    console.error(message);
    throw error;
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([child.exited, Bun.sleep(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }
    if (stopping) {
      await status("stopped");
    }
  }
}

if (import.meta.main) {
  const directory = process.env.NAKAMA_WORKER_DATA_DIR;
  const pluginDataDir = process.env.NAKAMA_PLUGIN_DATA_DIR;
  if (!(directory && pluginDataDir)) {
    throw new Error("Run this worker through Nakama");
  }
  await runWorker(directory, pluginDataDir);
}
