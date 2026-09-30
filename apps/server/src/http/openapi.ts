import { DEFAULT_SERVER_URL, NAKAMA_API_VERSION } from "@nakama/core";
import type { HonoApp } from "./types";

/** Rendered by the /docs reference as the Slack section's guide. */
const SLACK_TAG_DESCRIPTION = `Chat with an agent from Slack DMs and channel threads. The bridge uses Socket Mode, so the server needs no public URL and the app needs no Slack review.

A Slack connection belongs to one agent, like the other channels, and one Slack app serves one connection.

**Setup** (org admin, **Agents → your agent → Connections → Slack**)

1. Click **Copy manifest**, open [Slack apps](https://api.slack.com/apps?new_app=1), choose **From a manifest**, and paste it.
2. **Install App → Install to Workspace**, then copy the **Bot User OAuth Token** (\`xoxb-\`).
3. **Basic Information → App-Level Tokens**, generate one with the \`connections:write\` scope (\`xapp-\`).
4. Paste both tokens and save. Nakama checks them with Slack first.
5. Start the worker, then send the pairing code to the app's **Messages** tab in Slack.

**Using it**

- DM the app, or \`@mention\` it in a channel it was invited to. It replies in a thread and follows that thread.
- Only paired members, or member IDs under **Allowed users**, are answered. Turn on **Everyone in the workspace** to let every full member in (needs the \`users:read\` scope); guests and people from other orgs still need pairing.
- Commands start with \`!\` because Slack keeps \`/\` for its own: \`!new\`, \`!clear\`, \`!stop\`, \`!status\`, \`!help\`.

The endpoints below back the connection card. They take the agent as \`?profileId=\` and need an org admin or platform admin.`;

export function buildHttpOpenApiSpec(app: HonoApp, serverUrl?: string) {
  return app.getOpenAPI31Document({
    info: {
      description: "HTTP API for the Nakama personal AI assistant.",
      title: "Nakama API",
      version: String(NAKAMA_API_VERSION),
    },
    openapi: "3.1.0",
    servers: [
      {
        description: "Local dev server",
        url: serverUrl ?? DEFAULT_SERVER_URL,
      },
    ],
    tags: [
      { name: "Health" },
      { name: "Auth" },
      { name: "Workers" },
      { name: "Chat" },
      { name: "Models" },
      { name: "User" },
      { name: "Profiles" },
      { name: "Soul" },
      { name: "Skills" },
      { name: "MCP" },
      { name: "Tools" },
      { name: "Automations" },
      { name: "Tasks" },
      { name: "Organizations" },
      { description: SLACK_TAG_DESCRIPTION, name: "Slack" },
    ],
  });
}

export function serializeHttpOpenApiSpec(
  app: HonoApp,
  serverUrl?: string
): string {
  return JSON.stringify(buildHttpOpenApiSpec(app, serverUrl), null, 2);
}
