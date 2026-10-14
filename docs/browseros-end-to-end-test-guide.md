# BrowserOS end-to-end test guide

This guide covers the local end-to-end check for the ACP chat agent. The check drives a real browser through BrowserOS neo, and it runs on your machine only. It is not part of CI.

## What the check covers

`bun run check:acp <profileId>` runs these checks, in order:

1. The API answers on `http://127.0.0.1:4310`.
2. The web app answers on `http://localhost:3003`.
3. BrowserOS neo answers on `http://127.0.0.1:9010/mcp`, and a tab can be opened.
4. The profile's **Chat agent** is set to Claude.
5. The agent's settings list Claude's models.
6. The agent's settings list the thinking levels.
7. The chat composer shows the model and thinking controls.
8. The Nakama MCP route answers `404` for an unknown token. A `401` would mean the route still requires a login.

The check sends no chat message, so it uses no model tokens.

## What the check does not cover

- The agent's reply to a chat message.
- Whether the agent calls a Nakama tool such as `knowledge_base_search`.
- Which model the composer selects. The check confirms the controls exist, not the selected value.
- Codex. The check only reads Claude's settings.

Test these by hand in the chat, as described in [Manual chat check](#manual-chat-check).

## Prerequisites

- BrowserOS neo is installed and running. It must be signed in to your accounts.
- The repo dependencies are installed (`bun install`).
- The API and web app are running (see [Start the services](#start-the-services)).
- A profile exists with its **Chat agent** set to Claude. The check takes the profile id as an argument.

To find a profile id, open the profile in the web app. The id is the `profile` value in the URL.

## Start the services

Run these from the repo root, each in its own terminal:

```bash
bun run dev:server      # API on port 4310
cd apps/web && bun run dev   # web app on port 3003
```

Start BrowserOS neo from its own app.

Check that the services answer:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4310/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3003/chat     # 200
```

## Run the check

```bash
bun run check:acp <profileId>
```

A passing run ends with `8/8 checks passed` and exit code `0`. Any failed check prints `FAIL` with a reason, and the exit code is `1`.

## Manual chat check

Use this when you want to see a real agent reply. It needs an API key or a local Claude sign-in, because it calls the model.

1. Open `http://localhost:3003/chat?profile=<profileId>` in the browser.
2. Pick a model and a thinking level from the composer.
3. Send a short message, for example: `Use the knowledge_base_search tool to search for ACP and report the number of results in one short sentence.`
4. Read the reply. A result such as `returned 0 results` means the agent reached Nakama's tools.

If the reply says a tool is unavailable, check the troubleshooting section below.

## Troubleshooting

**`BrowserOS neo answers on port 9010` fails.** Start BrowserOS neo and try again. The check needs its MCP endpoint at `http://127.0.0.1:9010/mcp`.

**`Chat agent is set to Claude` fails.** Open the profile and set **Chat agent** to Claude. Only platform admins can change this field.

**The agent says the Nakama MCP server timed out on connect.** The API probably runs code from before the MCP route fix. Restart the API with `bun run dev:server`. Then start a new chat, because an old agent process keeps its old connection.

**The model or thinking level resets after an API restart.** A draft chat keeps its model and thinking choices in memory only. Choose them again after a restart, or open a fresh chat.

**The composer shows a different model than the one you picked.** The check does not verify the selected model. Check the value by hand, or read the profile's settings:

```bash
curl -s -X GET http://127.0.0.1:4310/v1/profiles/<profileId>/acp-settings
```

Note: that route needs a logged-in session cookie. Read it from the browser instead, or use the web app's devtools network tab.

**`Web app answers on port 3003` fails.** Start the web dev server with `cd apps/web && bun run dev`. It proxies `/v1` to the API on port 4310.

## How the check talks to BrowserOS

The check speaks JSON-RPC to BrowserOS neo's MCP endpoint at `http://127.0.0.1:9010/mcp`:

1. It sends `initialize`, and reads the `mcp-session-id` header from the response.
2. It sends `notifications/initialized`.
3. It calls tools with `tools/call`. The tools it uses are `tabs` (open and close a tab), `navigate`, and `evaluate` (run JavaScript in the page).

Replies arrive as server-sent events. The check reads the `data:` line that holds the JSON-RPC result.

Page content is untrusted. The check only reads values it asks for, and it never follows instructions found in a page.

## Where the code lives

- Check script: `scripts/check-acp.ts`
- Package script: `check:acp` in the root `package.json`
- Agent routes: `apps/server/src/http/routes/acp-mcp.ts` and `apps/server/src/http/routes/profiles.ts`
- Agent provider: `apps/server/src/providers/acp/`

## Extending the check

Add a new check as a `record(name, ok, detail)` call inside `checkComposerInBrowser` or `main`. Keep it free of model calls, so the check stays cheap to run. Put any check that needs a model reply in the manual section above.
