// @bun
// src/worker.ts
import { createHash, randomUUID } from "crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "fs/promises";
import { join } from "path";

// ../../core/src/supermemory-client.ts
function normalizeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid server URL");
  }
  const host = url.hostname;
  const octets = host.split(".").map(Number);
  const privateHost = host === "localhost" || host === "[::1]" || octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) && (octets[0] === 127 || octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || url.protocol === "http:" && privateHost)) {
    throw new Error("Use HTTPS, or HTTP on a private IP or localhost; omit credentials, query and fragment");
  }
  return url.toString().replace(/\/+$/, "");
}
// src/client.ts
async function validateExtraction(config) {
  if (!(config.apiKey?.trim() && config.model?.trim() && config.revision?.trim())) {
    throw new Error("Configure an extraction API key and model in Supermemory Settings");
  }
  const response = await fetch(`${normalizeUrl(config.baseUrl)}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        { content: "Return JSON with ok set to true.", role: "user" }
      ],
      model: config.model,
      response_format: {
        json_schema: {
          name: "connection_check",
          schema: {
            additionalProperties: false,
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            type: "object"
          },
          strict: true
        },
        type: "json_schema"
      }
    }),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const body2 = await response.json().catch(() => ({}));
    const reason = typeof body2?.error?.message === "string" ? body2.error.message : `HTTP ${response.status}`;
    throw new Error(`Extraction provider rejected the check: ${reason.replaceAll(config.apiKey, "[REDACTED]").replace(/Bearer\s+[^\s,"}]+/gi, "Bearer [REDACTED]").slice(0, 300)}`);
  }
  const body = await response.json().catch(() => ({}));
  const content = body?.choices?.[0]?.message?.content;
  let valid = false;
  try {
    valid = typeof content === "string" && JSON.parse(content)?.ok === true;
  } catch {}
  if (!valid) {
    throw new Error("Extraction model did not return the required structured response");
  }
}

// src/worker.ts
var VERSION = "0.0.8";
var CHECKSUMS = {
  "darwin-arm64": "12b7817a105ed0a9e70f96c461fb6f8dded5d70eaeb6034e774778c257bed78a",
  "darwin-x64": "2b50821fc2b0a952d1431fa5daf5af19a350748a82e1242a65c4a1e5cb453beb",
  "linux-arm64": "eeb9e62a8bf59646bd799a05d1a2981b945413a03640c3a39f4f267ad2d2bf37",
  "linux-x64": "87f32433d0179be80bb9d8a1bafbac65af4128324342a27ecb8bd1a77b5506f3"
};
function providerEnvironment(config) {
  if (!config) {
    throw new Error("Configure an AI provider in Nakama Settings, then restart Supermemory in Workers.");
  }
  const key = config.apiKey?.trim();
  if (config.type === "anthropic" && key) {
    return { ANTHROPIC_API_KEY: key };
  }
  if (config.type === "gemini" && key) {
    return { GEMINI_API_KEY: key };
  }
  const baseUrls = {
    deepseek: "https://api.deepseek.com/v1",
    ollama: "http://localhost:11434/v1",
    openai: "https://api.openai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    together: "https://api.together.xyz/v1",
    xai: "https://api.x.ai/v1"
  };
  let baseUrl = (config.baseUrl || baseUrls[config.type])?.replace(/\/$/, "");
  if (config.type === "ollama" && baseUrl && !baseUrl.endsWith("/v1")) {
    baseUrl += "/v1";
  }
  if ((key || config.type === "ollama") && baseUrl && !["chatgpt", "xai_oauth", "cloudflare"].includes(config.type)) {
    return {
      OPENAI_API_KEY: key || "ollama",
      OPENAI_BASE_URL: baseUrl.replace(/\/$/, ""),
      ...config.model ? { OPENAI_MODEL: config.model } : {}
    };
  }
  throw new Error("Select an API-key or local AI provider in Nakama Settings, then restart Supermemory in Workers. Subscription sign-ins are not supported by the local Supermemory server.");
}
async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
async function installServer(directory, signal) {
  await mkdir(directory, { mode: 448, recursive: true });
  const platform = `${process.platform}-${process.arch}`;
  const expected = CHECKSUMS[platform];
  if (!expected) {
    throw new Error("Supermemory local supports macOS and Linux on x64 or arm64");
  }
  const path = join(directory, `supermemory-server-${VERSION}`);
  if (await Bun.file(path).exists() && await sha256(path) === expected) {
    await chmod(path, 448);
    return path;
  }
  const response = await fetch(`https://github.com/supermemoryai/supermemory/releases/download/server-v${VERSION}/supermemory-server-${platform}`, {
    signal: AbortSignal.any([
      AbortSignal.timeout(300000),
      ...signal ? [signal] : []
    ])
  });
  if (!(response.ok && response.body)) {
    throw new Error("Could not download Supermemory; restart the worker to retry");
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
    if (await sha256(temporary) !== expected) {
      throw new Error("Supermemory download checksum mismatch");
    }
    await chmod(temporary, 448);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}
function startExtractionProxy(config, signal) {
  const token = randomUUID();
  const upstream = `${normalizeUrl(config.baseUrl)}/chat/completions`;
  const server = Bun.serve({
    async fetch(request) {
      if (request.headers.get("Authorization") !== `Bearer ${token}`) {
        return new Response(null, { status: 401 });
      }
      if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") {
        return new Response(null, { status: 404 });
      }
      try {
        const body = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return new Response(null, { status: 400 });
        }
        if (body.serviceTier !== undefined) {
          body.service_tier ??= body.serviceTier;
          delete body.serviceTier;
        }
        if (body.max_tokens !== undefined) {
          body.max_completion_tokens ??= body.max_tokens;
          delete body.max_tokens;
        }
        if (body.response_format?.type === "json_object" && Array.isArray(body.messages)) {
          body.messages = [
            { content: "Return valid JSON.", role: "system" },
            ...body.messages
          ];
        }
        if (config.model === "gpt-5.6-luna" && Array.isArray(body.tools) && body.tools.length > 0) {
          body.reasoning_effort = "none";
        }
        body.model = config.model;
        const response = await fetch(upstream, {
          body: JSON.stringify(body),
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json"
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(120000),
            ...signal ? [signal] : []
          ])
        });
        return new Response(response.body, {
          headers: {
            "Content-Type": response.headers.get("Content-Type") ?? "application/json"
          },
          status: response.status
        });
      } catch {
        return Response.json({ error: { message: "Extraction provider request failed" } }, { status: 502 });
      }
    },
    hostname: "127.0.0.1",
    maxRequestBodySize: 2 * 1024 * 1024,
    port: 0
  });
  return { baseUrl: `http://127.0.0.1:${server.port}/v1`, server, token };
}
async function runWorker(directory, pluginDataDir) {
  await mkdir(directory, { mode: 448, recursive: true });
  const statusPath = join(directory, "status.json");
  const status = async (state, message) => {
    await writeFile(statusPath + ".tmp", JSON.stringify({ message, state }), {
      mode: 384
    });
    await rename(statusPath + ".tmp", statusPath);
  };
  await status("starting");
  let child;
  let proxy;
  let stopping = false;
  const abort = new AbortController;
  const stop = () => {
    stopping = true;
    abort.abort();
    child?.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    if (await Bun.file(join(pluginDataDir, "connection.json")).exists()) {
      await status("external");
      console.log("Using the existing external Supermemory connection.");
      while (!stopping) {
        await Bun.sleep(1000);
      }
      return;
    }
    const automatic = await Bun.file(join(directory, "auto-provider.json")).json().catch(() => null);
    if (automatic?.type !== "openai" || !automatic.apiKey?.trim()) {
      throw new Error("Add an OpenAI provider in Settings, then restart Supermemory in Workers.");
    }
    const config = {
      apiKey: automatic.apiKey,
      baseUrl: automatic.baseUrl?.trim() || "https://api.openai.com/v1",
      model: automatic.model,
      revision: createHash("sha256").update(JSON.stringify([
        "openai-parameters-v1",
        automatic.apiKey,
        automatic.baseUrl,
        automatic.model
      ])).digest("hex")
    };
    await status("validating", "Checking the extraction provider");
    await validateExtraction(config);
    proxy = startExtractionProxy(config, abort.signal);
    const provider = providerEnvironment({
      ...config,
      apiKey: proxy.token,
      baseUrl: proxy.baseUrl,
      type: "openai_compatible"
    });
    console.log("Preparing Supermemory server " + VERSION);
    const binary = await installServer(join(directory, "cache"), abort.signal);
    if (stopping) {
      return;
    }
    const store = join(directory, "data");
    const home = join(directory, "home");
    await mkdir(home, { mode: 448, recursive: true });
    await mkdir(store, { mode: 448, recursive: true });
    const reservation = Bun.serve({
      fetch: () => new Response,
      hostname: "127.0.0.1",
      port: 0
    });
    const port = reservation.port;
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
        SUPERMEMORY_SKIP_EMBEDDING_PREWARM: "1"
      },
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore"
    });
    const deadline = Date.now() + 180000;
    let ready = false;
    while (!stopping && child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
      try {
        const token = (await readFile(join(store, "api-key"), "utf8")).trim();
        if (!token) {
          throw new Error("Waiting for credentials");
        }
        const response = await fetch(url + "/v3/documents/list", {
          body: JSON.stringify({ limit: 1 }),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          method: "POST",
          signal: AbortSignal.timeout(2000)
        });
        await response.body?.cancel();
        if (response.ok) {
          const path = join(directory, "connection.json");
          await writeFile(path + ".tmp", JSON.stringify({ revision: config.revision, token, url }), {
            mode: 384
          });
          await rename(path + ".tmp", path);
          ready = true;
          await status("ready");
          console.log("Supermemory is ready.");
          break;
        }
      } catch {}
      await Bun.sleep(500);
    }
    if (!(ready || stopping)) {
      throw new Error("Supermemory did not become ready; check the configured AI provider and restart the worker");
    }
    await child.exited;
    if (!stopping) {
      throw new Error("Supermemory exited; restart the worker to retry");
    }
  } catch (error) {
    if (stopping) {
      return;
    }
    const message = error instanceof Error ? error.message : "Supermemory could not start";
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
    await proxy?.server.stop(true);
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
export {
  installServer,
  providerEnvironment,
  startExtractionProxy
};
