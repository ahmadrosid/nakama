/**
 * Stdio MCP server that an ACP agent starts for Nakama's tools. ACP agents must
 * accept stdio MCP servers, so this relays each JSON-RPC line from the agent to
 * Nakama's HTTP endpoint and writes the reply back on stdout.
 *
 * It runs as `node -e` or `bun -e` with the source below, so no file has to be
 * shipped next to the server. The endpoint URL (which holds the chat's secret
 * token) comes from the environment, not from the command line.
 */
export const ACP_MCP_BRIDGE_SOURCE = `
const { createInterface } = require("node:readline");
const url = process.env.NAKAMA_ACP_MCP_URL;

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;

  try {
    const response = await fetch(url, {
      body: line,
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (response.status === 202 || response.status === 204) return;

    const text = (await response.text()).trim();
    if (text) process.stdout.write(text + "\\n");
  } catch (error) {
    const id = (() => { try { return JSON.parse(line).id ?? null; } catch { return null; } })();
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ error: { code: -32603, message }, id, jsonrpc: "2.0" }) + "\\n");
  }
});
`;
