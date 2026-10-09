/**
 * Local check for the ACP chat agent. It sends no chat message, so it uses no
 * model tokens. Run it when BrowserOS neo, the API (port 4310), and the web app
 * (port 3003) are up:
 *
 *   bun run scripts/check-acp.ts <profileId>
 *
 * Checks, in order:
 *   1. API and web app answer.
 *   2. The profile's chat agent is set (not the built-in chat).
 *   3. The agent's settings list Claude's models and effort levels.
 *   4. The composer shows the ACP agent group in its model picker.
 *   5. The Nakama MCP route is reachable without a login (it answers 404 for an
 *      unknown token, not 401).
 */

const BROWSEROS_MCP = "http://127.0.0.1:9010/mcp";

const API = "http://127.0.0.1:4310";

const WEB = "http://localhost:3003";

const profileId = process.argv[2];

if (!profileId) {
  console.error("usage: bun run scripts/check-acp.ts <profileId>");
  process.exit(2);
}

type Check = { name: string; ok: boolean; detail: string };

const results: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ detail, name, ok });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`
  );
}

async function getText(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, init);

  return { body: await res.text(), status: res.status };
}

// --- BrowserOS neo over MCP (same JSON-RPC calls used in the browser test) ---

let mcpSession: string | null = null;

async function mcpPost(
  bodyJson: string
): Promise<{ headers: Headers; text: string }> {
  const base = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };

  const headers = mcpSession ? { ...base, "mcp-session-id": mcpSession } : base;

  const res = await fetch(BROWSEROS_MCP, {
    body: bodyJson,
    headers,
    method: "POST",
  });

  return { headers: res.headers, text: await res.text() };
}

function parseSse(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

async function mcpInit(): Promise<boolean> {
  try {
    const init = await mcpPost(
      JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "nakama-check-acp", version: "1" },
          protocolVersion: "2025-06-18",
        },
      })
    );

    mcpSession = init.headers.get("mcp-session-id");
    await mcpPost(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    );

    return mcpSession !== null;
  } catch {
    return false;
  }
}

async function mcpTool(
  name: string,
  args: Record<string, string | number>
): Promise<string> {
  const reply = await mcpPost(
    JSON.stringify({
      id: Math.floor(Math.random() * 1e9),
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: args, name },
    })
  );

  // SAFETY: The reply is a JSON-RPC message from BrowserOS, and only its
  // text content is read below.
  const message = parseSse(reply.text).at(-1) as
    | { result?: { content?: Array<{ text?: string }> } }
    | undefined;

  return (message?.result?.content ?? [])
    .map((part) => part.text ?? "")
    .join("\n");
}

// --- checks ---

async function checkServices(): Promise<void> {
  const api = await getText(`${API}/health`).catch(() => null);
  record(
    "API answers on port 4310",
    api?.status === 200,
    api ? `HTTP ${api.status}` : "no response"
  );

  const web = await getText(`${WEB}/chat`).catch(() => null);
  record(
    "Web app answers on port 3003",
    web?.status === 200,
    web ? `HTTP ${web.status}` : "no response"
  );
}

async function checkComposerInBrowser(): Promise<void> {
  if (!(await mcpInit())) {
    record(
      "BrowserOS neo answers on port 9010",
      false,
      "start BrowserOS neo and try again"
    );

    return;
  }

  record("BrowserOS neo answers on port 9010", true, "");

  const opened = await mcpTool("tabs", {
    action: "new",
    url: `${WEB}/profiles?profile=${profileId}`,
  });

  const page = /opened page (\d+)/.exec(opened)?.[1];

  if (!page) {
    record("Open a BrowserOS tab", false, opened.slice(0, 120));

    return;
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // Reads what the logged-in page shows: the Chat agent value and the profile's settings.
    const profileCheck = await mcpTool("evaluate", {
      code: `
        const agent = [...document.querySelectorAll('[role="combobox"]')]
          .find((el) => el.getAttribute('aria-label') === 'Chat agent');
        const value = agent ? agent.textContent.trim() : null;
        const settings = await (await fetch('/v1/profiles/${profileId}/acp-settings', { credentials: 'include' })).json();
        const body = JSON.parse(settings.body ?? 'null') ?? settings;
        const model = (body.settings ?? []).find((s) => s.category === 'model');
        const effort = (body.settings ?? []).find((s) => s.category === 'thought_level');
        return 'CHECK ' + JSON.stringify({
          agentValue: value,
          modelOptions: model ? model.options.map((o) => o.name) : [],
          effortOptions: effort ? effort.options.map((o) => o.name) : [],
        });`,
      page: Number(page),
    });

    const profileJson = /CHECK (\{.*\})/.exec(profileCheck)?.[1];

    // SAFETY: profileJson is the JSON that the page snippet above built.
    const info = profileJson
      ? (JSON.parse(profileJson) as {
          agentValue: string | null;
          modelOptions: string[];
          effortOptions: string[];
        })
      : null;

    record(
      "Chat agent is set to Claude",
      info?.agentValue === "Claude",
      info
        ? `shows "${info.agentValue}"`
        : "could not read the Chat agent field"
    );
    record(
      "Agent offers Claude's models",
      (info?.modelOptions.length ?? 0) > 0,
      info ? `${info.modelOptions.length} models` : ""
    );
    record(
      "Agent offers thinking levels",
      (info?.effortOptions.length ?? 0) > 0,
      info ? `${info.effortOptions.join(", ")}` : ""
    );

    await mcpTool("navigate", {
      page: Number(page),
      url: `${WEB}/chat?profile=${profileId}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 6000));

    const composer = await mcpTool("evaluate", {
      code: `
        const picker = document.querySelector('[aria-label="Select model"]');
        const effort = document.querySelector('[aria-label="Thinking effort"]');
        return 'CHECK ' + JSON.stringify({
          model: picker ? picker.textContent.trim() : null,
          effort: effort ? effort.textContent.trim() : null,
        });`,
      page: Number(page),
    });

    const composerJson = /CHECK (\{.*\})/.exec(composer)?.[1];

    // SAFETY: composerJson is the JSON that the page snippet above built.
    const shown = composerJson
      ? (JSON.parse(composerJson) as {
          model: string | null;
          effort: string | null;
        })
      : null;

    record(
      "Composer shows the agent's model and thinking controls",
      Boolean(shown?.model && shown.effort),
      shown ? `model "${shown.model}", effort "${shown.effort}"` : "not found"
    );
  } finally {
    await mcpTool("tabs", { action: "close", page: Number(page) }).catch(
      () => undefined
    );
  }
}

async function checkMcpRoute(): Promise<void> {
  const res = await getText(
    `${API}/v1/acp-mcp/check-token-that-does-not-exist`,
    {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  ).catch(() => null);

  record(
    "Nakama MCP route is reachable without a login",
    res?.status === 404,
    res
      ? `HTTP ${res.status} (404 means reachable; 401 would mean login is required)`
      : "no response"
  );
}

async function main(): Promise<void> {
  console.log(`Checking ACP chat agent for profile ${profileId}\n`);
  await checkServices();
  await checkComposerInBrowser();
  await checkMcpRoute();

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
