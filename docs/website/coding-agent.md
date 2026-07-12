# Coding Agent

A Nakama profile is a general-purpose agent: it chats, explains, uses file tools, and follows your soul and skills. For **real coding work** — multi-file features, refactors, test fixes, repo-wide changes — a dedicated **coding agent** (Codex, Claude Code, or OpenCode) usually does better.

Nakama's coding-agent feature keeps you in the same chat while handing those tasks to the selected CLI on the server. The Nakama agent orchestrates; the coding agent executes.

The mental model:

- The user still talks to Nakama
- Nakama recognizes when the request is coding work, not casual explanation
- Nakama runs the configured coding-agent CLI through the `bash` tool
- Nakama summarizes stdout/stderr and continues the conversation

There is no separate delegate builtin. The workflow is **`bash` + the `coding-delegation` skill + a configured coding-agent harness** in Integrations.

## Why use a coding agent

Nakama can edit files with `read_file`, `write_file`, and `edit_file`, but that path is built for lighter, tool-loop edits. When users ask for substantial repo work, the general agent often struggles with scope, verification, and multi-step execution.

Dedicated coding agents are built for that job. Nakama adds this feature so you do not have to choose between "stay in Nakama" and "use a real coding CLI":

- **Nakama** stays the conversation owner, permission boundary, and summarizer
- **Coding agent** (Codex, Claude Code, or OpenCode) runs the heavy repo work on the server
- **Super Bot** is the default profile with `bash` and the `coding-delegation` skill; other profiles can opt in

## How the pieces fit together

| Piece | Role |
|-------|------|
| **Coding-agent harness** | Workspace setting: which CLI is installed, authenticated, and selected |
| **`coding-delegation` skill** | Teaches when to invoke a coding agent, how to build the `bash` command, and how to summarize results |
| **`bash` tool** | Runs the coding-agent CLI in the profile workspace |
| **Backend guidance** | Runtime-only bundled skills (`coding-backend-codex`, `coding-backend-claude-code`, `coding-backend-opencode`) injected on matched turns |

```text
User message (coding task)
  → skill matcher activates coding-delegation
  → Nakama injects harness context + backend CLI guidance
  → Nakama agent calls bash with the coding-agent command
  → Nakama agent summarizes the result for the user
```

See [Agent prompts](/agent-prompt) for where harness context lands in the prompt stack.

## Supported coding agents

Nakama supports three CLI-backed harnesses on the machine running the server:

| Agent | Default command | Typical use |
|-------|-----------------|-------------|
| **Codex** | `codex` | OpenAI Codex CLI one-shot `exec` runs |
| **Claude Code** | `claude` | Anthropic Claude Code print mode (`-p`) |
| **OpenCode** | `opencode` | Provider-agnostic OpenCode `run` |

Harness command paths can be overridden in Integrations when the binary is not on the default `PATH`.

## Setup

### 1. Configure a coding-agent harness

Platform admins open **Integrations → Coding agents** in the dashboard (`/integrations?section=coding-agents`).

For each backend:

1. **Select** the coding agent Nakama should prefer
2. **Install** the CLI on the server if it is missing (Nakama can run the documented global npm install from the UI)
3. **Verify** readiness — Nakama checks that the binary runs and is authenticated
4. **Save** workspace settings

Until at least one harness is installed and verified, coding-agent workflows are unavailable. When exactly one harness is ready and none is selected yet, Nakama auto-selects it at runtime.

### Model routing (inference gateway)

Nakama can route coding-agent API calls through the deployment instead of each agent's vendor account. The server exposes an Anthropic-compatible `POST /v1/messages` endpoint and injects spawn-time env vars so Claude Code (and eventually Codex) talk to Nakama instead of Anthropic/OpenAI directly.

**Local dev:** `bun run dev:server` enables the gateway by default (`NAKAMA_INFERENCE_GATEWAY_ENABLED=1`). Production deployments can opt out with `NAKAMA_INFERENCE_GATEWAY_ENABLED=0`.

**Requirements:**

- A provider configured in Nakama (Settings → model provider) — the gateway routes to that provider using the selected profile's model
- For `nakama launch`, a Nakama local auth token (automatic when using the CLI on the same machine as the server)

The `bash` tool merges spawn env when:

- `codingAgent: true` is set on the bash call, or
- the command starts with the active harness binary (auto-detection)

`nakama launch` always requests a launch plan from the server, which includes the same spawn env.

#### Server configuration

```bash
# enabled by default in bun run dev:server
export NAKAMA_INFERENCE_GATEWAY_ENABLED=1

# optional public URL when the server is not on localhost (Claude SDK appends /v1/messages):
# export NAKAMA_INFERENCE_GATEWAY_URL=https://nakama.example.com
```

#### Spawn env (Claude Code)

When the gateway is enabled, Nakama merges these variables at process spawn time:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_BASE_URL` | Nakama server root (for example `http://127.0.0.1:4310`) |
| `ANTHROPIC_AUTH_TOKEN` | Local Nakama auth token (Bearer auth to the gateway) |
| `ANTHROPIC_API_KEY` | Cleared/unset so shell keys do not override gateway routing |
| `ANTHROPIC_DEFAULT_*_MODEL` | All Claude Code tiers mapped to the profile model |
| `ANTHROPIC_CUSTOM_HEADERS` | `X-Org-Id` and `X-Nakama-Profile-Id` for tenant and model routing |

Nakama does **not** patch `~/.claude/settings.json`. Env injection is session-scoped, matching the Ollama-style pattern.

#### Gateway limitations (v1)

- Text-only requests — tool calling in gateway requests is not supported yet
- Claude Code first — Codex/OpenCode gateway adapters are partial
- Restart the server after upgrading — older processes will not register `POST /v1/coding-agents/prepare-launch` or the gateway route

#### Manual equivalent (Claude Code)

```bash
export NAKAMA_INFERENCE_GATEWAY_ENABLED=1  # on the server

ANTHROPIC_BASE_URL=http://127.0.0.1:4310 \
ANTHROPIC_AUTH_TOKEN=<your-local-nakama-token> \
ANTHROPIC_CUSTOM_HEADERS=$'X-Org-Id: org_abc\nX-Nakama-Profile-Id: <profile-id>' \
claude --print 'your task'
```

Unset `ANTHROPIC_API_KEY` in your shell if it is set — a leftover key can block gateway credentials.

If `~/.claude/settings.json` forces Bedrock or another upstream, env injection may not win — adjust Claude Code settings or remove conflicting entries.

### 2. Assign tools and skills to the profile

| Requirement | Super Bot | Other profiles |
|-------------|-----------|----------------|
| `bash` | Assigned by default | Assign manually |
| `coding-delegation` skill | Assigned by default | Assign manually |

Nakama blocks assigning `coding-delegation` until a harness is ready. The skill picker links to Integrations when setup is incomplete.

### 3. Chat from a profile with coding-agent access

When the user's message looks like a code-change request, the skill matcher attaches the full `coding-delegation` body plus harness context for that turn. The agent should call `bash` with an appropriate `timeoutMs` (often 10–30 minutes for large tasks; see [bash](/builtin-tools#bash)).

## Launch directly (CLI)

Power users can spawn an interactive coding agent from the terminal without going through chat:

```bash
bun run dev:cli -- launch claude
```

The CLI ensures the server is running, resolves org context, builds a launch plan via `POST /v1/coding-agents/prepare-launch`, and `exec`s the harness binary with merged spawn env.

### Flags

| Flag | Purpose |
|------|---------|
| `--org ID` | Organization for `X-Org-Id` (required when you belong to multiple orgs) |
| `--profile ID` | Profile for model routing through the gateway (aliases: `super_bot`, `super-bot`, `Super Bot`) |
| `--model MODEL` | Override the profile model for this launch |
| `--cwd DIR` | Working directory (defaults to your current shell directory) |
| `--yes` | Skip the profile picker when no `--profile` is set |
| `--save-harness` | Persist the selected harness in Integrations (org admins only) |
| `-- ARGS...` | Forward args to the coding CLI (for example one-shot `claude -p "task"`) |

Org and profile preferences are saved in `~/.nakama/cli.ini` (`org_id`, `profile_id`). You can also set `NAKAMA_ORG_ID` in the environment.

### Examples

```bash
# Interactive Claude Code in the current directory
bun run dev:cli -- launch claude --org org_abc --profile "Super Bot"

# One-shot print mode
bun run dev:cli -- launch claude --org org_abc --profile super_bot -- --print "fix failing tests"

# Codex with an explicit model override
bun run dev:cli -- launch codex --model gpt-4.1 -- --help
```

### Verify gateway routing

After launch, the CLI prints either:

- `Spawn env: Nakama inference gateway routing enabled` — Claude Code should **not** ask for `/login`
- A warning that no gateway env was applied — Claude Code will use its own Anthropic account (`/login`)

Inside Claude Code, run `/status` and confirm **Anthropic base URL** points at your Nakama server (not `api.anthropic.com`).

Without the gateway, the coding CLI uses vendor authentication on the host (`claude /login`, Codex login, etc.).

## When to use a coding agent vs Nakama alone

Use a **coding agent** when the user wants **concrete changes** in the current project:

- Implement a feature or fix a bug
- Refactor across multiple files
- Run targeted validation or fix failing tests
- Inspect the repo to make a specific change

Keep work **on the Nakama agent** (file tools only, no coding CLI) when the user wants:

- Explanation or brainstorming
- Product discussion or status updates
- Small, single-file edits that fit a simple tool loop
- Advice without repo changes

The `coding-delegation` skill description is tuned so explain-only messages do not auto-match.

## Runtime behavior

On a matched turn, Nakama injects:

- **Harness context** — selected coding agent and a shell command template
- **Backend guidance** — CLI flags, auth notes, and safety patterns for that agent only

The Nakama agent then:

1. Builds the shell command from the template and the task prompt
2. Calls `bash` with `codingAgent: true` (or a harness-shaped command) and a long timeout when needed
3. Reads stdout/stderr from the coding agent
4. Summarizes what changed, what was verified, and any follow-up risks

Runs execute in the **active profile workspace** when delegated from chat (`~/.nakama/orgs/{orgId}/profiles/{profileId}/`). `nakama launch` defaults to your **current shell directory** unless you pass `--cwd`. When the inference gateway is enabled, spawn env routes API calls through Nakama using the selected profile's model; otherwise the coding CLI uses vendor auth configured on the host.

## Safety boundaries

- Only profiles with **`bash` assigned** can invoke a coding agent
- File tools remain scoped to the profile workspace; the coding-agent path does not bypass path guards
- Do not use `bash` to create persistent `.sh` tool wrappers — register JavaScript tools under `~/.nakama/tools/` instead
- Coding agents may write broadly inside the workspace or repo they are pointed at; use narrow task prompts and review results before committing or shipping

## Permissions

| Actor | Configure harnesses | Assign `coding-delegation` | Use coding agent in chat | `nakama launch` |
|-------|---------------------|----------------------------|--------------------------|-----------------|
| Platform admin | Yes | Yes | Yes | Yes |
| Org admin | No | No | Yes (on assigned profiles) | Yes |
| Org member | No | No | Yes | Yes |
| Org viewer | No | No | No | No |

Harness settings are deployment-wide. Tool and skill assignment remain per profile.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Skill cannot be assigned | Open Integrations → Coding agents; install and verify a harness |
| Nakama explains instead of coding | Message may not match the skill; ask for an explicit repo change |
| `nakama launch` returns Not found | Restart `bun run dev:server` after upgrading — stale server missing `/v1/coding-agents/prepare-launch` |
| `nakama launch` returns Forbidden | Use `--org` with your org id; ensure you are not an org viewer |
| Unknown profile `super_bot` | Use `Super Bot`, `super-bot`, or the profile id from the dashboard — Super Bot's id is not always literally `super_bot` |
| CLI fails immediately | Binary missing from `PATH`, auth incomplete, or wrong harness selected |
| Claude Code asks for `/login` | Gateway off or spawn env not applied — restart `dev:server`; launch output should say gateway routing enabled; run `/status` inside Claude Code |
| Gateway 503 / no provider | Configure a model provider in Nakama Settings for the launch profile |
| Run times out | Increase `bash` `timeoutMs`; split the task into smaller coding-agent runs |
| Changes land outside the workspace | Command `cwd` or backend `--dir` may point outside the profile tree; `nakama launch` uses your shell cwd by default |

## Next steps

- [Builtin tools](/builtin-tools) — `bash` parameters and scope
- [Skills](/skills) — bundled skills catalog, including `coding-delegation`
- [Profiles](/profiles) — Super Bot and per-profile tool access
- [Agent prompts](/agent-prompt) — how matched skills and harness context join the system prompt
