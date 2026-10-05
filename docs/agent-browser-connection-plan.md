# Configure agent-browser connections

## Goal

Let a platform admin choose how each profile uses `agent-browser`. Keep managed Chrome as the default. Add local Chrome DevTools Protocol (CDP) mode for browsers that expose a CDP port, including BrowserOS Neo. Agents continue to use `bash` and the existing skill.

This is direct CDP access, not a BrowserOS Neo MCP connection. [Neo documents MCP for agents](https://github.com/browseros-ai/BrowserOS/blob/main/docs/neo/mcp/index.mdx). Do not claim that Neo's MCP tab isolation, audit, or replay covers CLI actions.

## Current behavior

- `SkillInstallDialog.tsx` checks CLI readiness, offers installation, and requires `bash` before skill assignment.
- `agent-browser-service.ts` checks the CLI version. Installation also downloads managed Chrome.
- The bundled `agent-browser` skill and `composeAgentBrowserCapabilityPrompt` instruct the agent to launch managed Chrome.
- `bash` runs on the Nakama host by default. A microsandbox or Docker container cannot assume it can reach a browser on the operator's host.
- Host `bash` can already attach to a reachable CDP port. A settings guard cannot restrict what an agent does through host `bash`.
- Nakama sends every assigned MCP tool definition to the model. A UI setting alone will not reduce tokens while BrowserOS Neo MCP remains assigned to the profile.
- The installed `agent-browser` on this host is `0.27.0`. It lacks `--pin-tab`. [Version `0.34.0` added strict tab binding](https://agent-browser.dev/changelog).

## Plan

1. Add `managed` and `local_cdp` modes to the existing profile record, SQLite migration and mapping, request and response contracts, and update route. Save an optional CDP port with the profile. Default existing profiles to `managed`. Accept ports from 1 to 65535; do not accept URLs. Keep the existing platform-admin check on `PUT /v1/profiles/:profileId` for these new fields. Copy the setting when a platform admin clones a profile.
2. Keep `GET /v1/settings/agent-browser` for host CLI status. Add a platform-admin connection test route beside it in `models.ts`. Require host `bash` for local CDP. Require `agent-browser` 0.34.0 or newer for CDP mode; do not change managed mode's version gate. Run a bounded, read-only `agent-browser --cdp <port> tab list` test. Return status without tab titles or URLs.
3. Extend `agent-browser-service.ts` and its install route with a CLI-only install option for CDP mode. Keep the Chrome download for managed mode. Extend `SkillInstallDialog.tsx` with **Managed Chrome**, **Local CDP**, a port field, and **Test connection**. Show an upgrade action when the CLI is too old. State that local CDP controls the browser directly.
4. Pass the profile mode, port, and an opaque CLI session name into the browser capability prompt. Generate a unique name when each Nakama chat session starts. Update the bundled `agent-browser` skill for both modes. Start CDP work with `agent-browser --session <name> --cdp <port> --pin-tab open <url>`. Reuse that name for later commands. On `tab_gone`, open a new tab; never adopt another tab. Report connection failure instead of launching managed Chrome. Close the CLI session after the task.
5. Invalidate cached chat sessions when a profile's browser mode or port changes. Rebuild their prompt before the next turn. Do not let an old session continue using a previous CDP target.
6. Keep MCP assignment separate. Tell admins to remove BrowserOS Neo MCP from this profile to avoid its tool definitions. Do not change other profiles or server-wide MCP settings.
7. Update `docs/website/content/docs/agent-browser.mdx` with both modes, a local CDP example, and the limits for Docker and microsandbox deployments.

## Acceptance checks

1. Existing profiles still use managed Chrome without a settings change.
2. A platform admin can save a local CDP port for one profile. A non-admin cannot select local CDP.
3. The test reports success for a reachable CDP browser and clear failures for a closed port or old CLI. It does not open, close, or change a tab.
4. The agent uses a unique named session, `--cdp <port>`, and `--pin-tab` through `bash`. Managed mode keeps its current commands.
5. The skill can be assigned in local CDP mode when the CLI is installed, even if managed Chrome is not installed.
6. Parallel CDP sessions use separate tabs. A closed tab gives `tab_gone`; the agent does not act on another tab. Closing the CLI session leaves the browser open.
7. Changing one profile does not change another profile. Existing chat sessions use the new mode on their next turn.
8. Cloning a CDP profile copies its browser setting with its skill and tool assignments.
9. A stale CDP port gives a clear error. The agent does not switch to managed Chrome.
10. Removing BrowserOS Neo MCP from the profile removes its tool definitions from later model requests. Compare input tokens on the same simple chat turn before and after removal; report the measured difference without claiming savings from the UI alone.
11. Run focused service, route, and skill-prompt tests, then the web type check and repository lint check. Check the form by browser only if browser verification is requested.

## Scope limits

Support local CDP only. Defer remote URLs, port discovery, new browser providers, and automatic MCP removal. Require the admin to enter the browser's current CDP port; do not assume `9110` stays fixed. Reject CDP mode with microsandbox `bash`. In Docker, the test must report when the container cannot reach the browser. `--pin-tab` prevents accidental tab changes; it does not stop host `bash` from reaching other tabs.

## Evidence

- [agent-browser CDP mode](https://agent-browser.dev/cdp-mode) says `--pin-tab` opens a fresh tab and stops silent rebinding after tab loss.
- [agent-browser sessions](https://agent-browser.dev/sessions) says shared CDP sessions only separate tab selection. They do not isolate browser storage.
- [agent-browser changelog](https://agent-browser.dev/changelog) places strict tab binding in version `0.34.0`.
- [BrowserOS Neo agent setup](https://github.com/browseros-ai/BrowserOS/blob/main/docs/neo/mcp/index.mdx) documents MCP. It does not document direct `agent-browser` attachment.
