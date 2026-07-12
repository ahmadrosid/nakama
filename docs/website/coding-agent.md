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

### Model routing (optional inference gateway)

When `NAKAMA_INFERENCE_GATEWAY_ENABLED=1`, Nakama can route coding-agent API calls through the deployment instead of each agent's vendor account. The `bash` tool merges spawn-time env vars (for example `ANTHROPIC_BASE_URL`) when:

- `codingAgent: true` is set on the bash call, or
- the command starts with the active harness binary (auto-detection)

Enable the gateway with:

```bash
export NAKAMA_INFERENCE_GATEWAY_ENABLED=1
# optional host override (Anthropic SDK appends /v1/messages):
# export NAKAMA_INFERENCE_GATEWAY_URL=http://127.0.0.1:4310
```

Claude Code manual equivalent:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:4310 \
ANTHROPIC_API_KEY="" \
ANTHROPIC_AUTH_TOKEN=<your-local-nakama-token> \
claude --print 'your task'
```

If `~/.claude/settings.json` forces Bedrock or another upstream, env injection may not win — adjust Claude Code settings or remove conflicting entries.

### 2. Assign tools and skills to the profile

| Requirement | Super Bot | Other profiles |
|-------------|-----------|----------------|
| `bash` | Assigned by default | Assign manually |
| `coding-delegation` skill | Assigned by default | Assign manually |

Nakama blocks assigning `coding-delegation` until a harness is ready. The skill picker links to Integrations when setup is incomplete.

### 3. Chat from a profile with coding-agent access

When the user's message looks like a code-change request, the skill matcher attaches the full `coding-delegation` body plus harness context for that turn. The agent should call `bash` with an appropriate `timeoutMs` (often 10–30 minutes for large tasks; see [bash](/builtin-tools#bash)).

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

Runs execute in the **active profile workspace** (`~/.nakama/orgs/{orgId}/profiles/{profileId}/`). The coding CLI uses the server's environment and auth — complete login on the host running Nakama.

## Safety boundaries

- Only profiles with **`bash` assigned** can invoke a coding agent
- File tools remain scoped to the profile workspace; the coding-agent path does not bypass path guards
- Do not use `bash` to create persistent `.sh` tool wrappers — register JavaScript tools under `~/.nakama/tools/` instead
- Coding agents may write broadly inside the workspace or repo they are pointed at; use narrow task prompts and review results before committing or shipping

## Permissions

| Actor | Configure harnesses | Assign `coding-delegation` | Use coding agent in chat |
|-------|---------------------|----------------------------|--------------------------|
| Platform admin | Yes | Yes | Yes |
| Org admin | No | No | Yes (on assigned profiles) |
| Org member | No | No | Yes |
| Org viewer | No | No | No |

Harness settings are deployment-wide. Tool and skill assignment remain per profile.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Skill cannot be assigned | Open Integrations → Coding agents; install and verify a harness |
| Nakama explains instead of coding | Message may not match the skill; ask for an explicit repo change |
| CLI fails immediately | Binary missing from `PATH`, auth incomplete, or wrong harness selected |
| Run times out | Increase `bash` `timeoutMs`; split the task into smaller coding-agent runs |
| Changes land outside the workspace | Command `cwd` or backend `--dir` may point outside the profile tree |

## Next steps

- [Builtin tools](/builtin-tools) — `bash` parameters and scope
- [Skills](/skills) — bundled skills catalog, including `coding-delegation`
- [Profiles](/profiles) — Super Bot and per-profile tool access
- [Agent prompts](/agent-prompt) — how matched skills and harness context join the system prompt
