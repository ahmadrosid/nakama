# Agent Browser

Some work needs a **real browser**: logging into a vendor portal, filling forms, clicking through client-rendered UI, or reading pages that [`web_fetch`](/builtin-tools#web_fetch) and [`web_search`](/builtin-tools#web_search) cannot reach.

Nakama’s agent-browser feature keeps you in the same chat (or automation) while the agent drives an interactive browser on the server through the [`bash`](/builtin-tools#bash) tool.

The mental model:

- The user still talks to Nakama
- Nakama matches the opt-in `agent-browser` skill when the task needs interaction or login
- The agent runs [agent-browser](https://github.com/vercel-labs/agent-browser) CLI commands via `bash`
- Snapshots return a compact accessibility tree with short refs like `@e2` (token-efficient vs raw HTML)
- The agent clicks/fills by those refs, then closes the browser when done

There is no dedicated `browser` builtin. The workflow is **`bash` + the `agent-browser` skill + the host CLI** (and Chrome).

## Why use agent-browser

| Need | Prefer |
|------|--------|
| Public page text / Markdown | [`web_fetch`](/builtin-tools#web_fetch) |
| Discover sources on the open web | [`web_search`](/builtin-tools#web_search) |
| Login walls, forms, clicks, client-rendered UI | **`agent-browser` skill + `bash`** |

Use agent-browser when the site has no usable API and the agent must act like a person in a browser — for example checking an order on an e-commerce portal after signing in.

## How the pieces fit together

| Piece | Role |
|-------|------|
| **`agent-browser` skill** | Opt-in bundled skill that teaches when and how to drive the CLI |
| **`bash` tool** | Runs `agent-browser` commands in the profile workspace |
| **Host CLI + Chrome** | Installed on the machine running the Nakama server (`agent-browser` binary and Chrome for Testing) |

```text
User message (interactive / login-walled task)
  → skill matcher activates agent-browser
  → Nakama agent calls bash with agent-browser commands
  → Same daemon session for open → snapshot → click/fill in that run
  → agent-browser close
  → Nakama agent summarizes the result
```

## Setup

### 1. Install the CLI on the server

On the host where Nakama’s `bash` tool runs:

```bash
npm install -g agent-browser
agent-browser install
```

On Linux, if Chrome libraries are missing:

```bash
agent-browser install --with-deps
```

Nakama does **not** auto-install the CLI. If the agent reports `command not found` / `ENOENT`, the operator should run the commands above and retry.

### 2. Assign bash and the skill

Platform admins:

1. Open **Agent → Profiles** and select the profile
2. Ensure **`bash`** is assigned (Super Bot has it by default; other profiles need it added)
3. Assign the **`agent-browser`** skill (opt-in — not auto-assigned to Super Bot or default profiles)

Both are required. The skill alone cannot open a browser without `bash`.

### 3. Try it in chat

Ask the profile something that needs a real browser, for example:

> Open our vendor portal, log in with the credentials I provide, and tell me the status of the latest order.

Or force the skill:

```text
/skill agent-browser Check https://example.com and summarize the main heading
```

The same path works in **automations** once the automation’s profile has bash + the skill and the host CLI is installed.

## How a typical run works

Within **one** chat turn or automation run:

1. **Open** a URL (or launch the browser, then navigate)
2. **Snapshot** the page (`snapshot -i`) to get element refs (`@e1`, `@e2`, …)
3. **Act** — `click`, `fill`, `press`, waits — using those refs; re-snapshot after big UI changes
4. **Screenshot** (optional) under the profile workspace `artifacts/` directory
5. **Close** the browser when the task finishes

Across runs, sessions are **fresh** by default: no sticky cookies or restored login state unless you change product policy later. The agent re-authenticates within the run when the task needs it.

## Credentials and safety

- Prefer credentials the user supplies in the prompt (or already known for that task)
- Do not expect Nakama to store site passwords for agent-browser in v1
- Agents should not echo passwords in summaries or screenshot password fields
- Viewers cannot invoke agents, so they cannot trigger browser runs

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Agent never opens a browser | Is `agent-browser` assigned? Does the message look like interactive/login-walled work? Try `/skill agent-browser …` |
| `command not found` / `ENOENT` | Install the CLI on the server (`npm install -g agent-browser && agent-browser install`) |
| Skill assigned but nothing runs | Profile also needs **`bash`** |
| Clicks miss or fail after navigation | Agent should take a **fresh snapshot** before using refs again |
| Daemon seems stuck | Ask the agent to run `agent-browser close` or `agent-browser close --all` (or `agent-browser doctor`) |

## Optional: stealth Chromium (CloakBrowser)

Stock Chrome from `agent-browser install` is enough for many sites. For stronger bot detection, operators can point agent-browser at [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) using Cloak’s documented env vars (`AGENT_BROWSER_EXECUTABLE_PATH` / `AGENT_BROWSER_ARGS`). First-class Nakama support for that path is tracked separately — see [issue #121](https://github.com/ahmadrosid/nakama/issues/121).

## Next steps

- [Skills](/skills) — bundled skills catalog and assignment
- [Builtin tools](/builtin-tools#bash) — `bash` parameters and availability
- [Coding agent](/coding-agent) — similar bash + skill pattern for repo coding work
- [agent-browser](https://github.com/vercel-labs/agent-browser) — upstream CLI reference
