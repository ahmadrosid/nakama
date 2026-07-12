---
name: coding-backend-opencode
description: Runtime prompt layer for OpenCode coding agent runs.
disable-model-invocation: true
include-body-on-match: true
---

You are preparing a coding agent run for [OpenCode](https://opencode.ai), a provider-agnostic, open-source AI coding agent with a TUI and CLI. Use it as an autonomous coding worker orchestrated via terminal/process tools.

## When to Use

- The user explicitly asks to use OpenCode.
- You want an external coding agent to implement, refactor, or review code.
- You need long-running coding sessions with progress checks.
- You want parallel task execution in isolated workdirs/worktrees.

## Prerequisites

- OpenCode installed: `npm i -g opencode-ai@latest` or `brew install anomalyco/tap/opencode`.
- Auth configured: `opencode auth login` or provider env vars (e.g. `OPENROUTER_API_KEY`).
- Verify readiness: `opencode auth list` should show at least one provider.
- A git repository for code tasks (recommended).
- `pty=true` for interactive TUI sessions.

## Binary Resolution

Shell environments may resolve different OpenCode binaries. If behavior differs between your terminal and the agent, check:

```
which -a opencode
opencode --version
```

If needed, pin an explicit binary path, e.g. `$HOME/.opencode/bin/opencode run '...'`.

## One-Shot Tasks

Prefer `opencode run` for bounded, non-interactive tasks (no pty needed):

```
opencode run 'Add retry logic to API calls and update tests'
```

Attach context files with `-f`:

```
opencode run 'Review this config for security issues' -f config.yaml -f .env.example
```

Show model thinking with `--thinking`, or force a specific model with `--model provider/model`.

## Interactive Sessions (Background)

For iterative work requiring multiple exchanges, start the TUI in the background:

```
opencode   # with background=true, pty=true — returns a session id
```

Then send prompts and monitor progress via process actions (`submit`, `poll`, `log`). Send follow-up input with `submit`, and exit cleanly with Ctrl+C (`\x03`) or kill the process.

**Important:** Do NOT use `/exit` — it is not a valid OpenCode command and opens an agent selector dialog instead. Use Ctrl+C or kill to exit.

### TUI Keybindings

| Key | Action |
|-----|--------|
| `Enter` | Submit message (press twice if needed) |
| `Tab` | Switch between agents (build/plan) |
| `Ctrl+P` | Open command palette |
| `Ctrl+X L` | Switch session |
| `Ctrl+X M` | Switch model |
| `Ctrl+X N` | New session |
| `Ctrl+X E` | Open editor |
| `Ctrl+C` | Exit OpenCode |

### Resuming Sessions

After exiting, OpenCode prints a session ID. Resume with `opencode -c` (continue last) or `opencode -s ses_abc123` (specific session).

## Common Flags

| Flag | Use |
|------|-----|
| `run 'prompt'` | One-shot execution and exit |
| `--continue` / `-c` | Continue the last OpenCode session |
| `--session <id>` / `-s` | Continue a specific session |
| `--agent <name>` | Choose OpenCode agent (build or plan) |
| `--model provider/model` | Force specific model |
| `--format json` | Machine-readable output/events |
| `--file <path>` / `-f` | Attach file(s) to the message |
| `--thinking` | Show model thinking blocks |
| `--variant <level>` | Reasoning effort (high, max, minimal) |
| `--title <name>` | Name the session |

## Procedure

1. Verify tool readiness: `opencode --version` and `opencode auth list`.
2. For bounded tasks, use `opencode run '...'` (no pty needed).
3. For iterative tasks, start `opencode` with `background=true, pty=true`.
4. Monitor long tasks with `poll` / `log`.
5. If OpenCode asks for input, respond via `submit`.
6. Exit with Ctrl+C (`\x03`) or kill — never `/exit`.
7. Summarize file changes, test results, and next steps back to the user.

## PR Review Workflow

OpenCode has a built-in PR command:

```
opencode pr 42
```

Or review in a temporary clone for isolation: clone the repo, then `opencode run 'Review this PR vs main. Report bugs, security risks, test gaps, and style issues.'` with the changed files attached via `-f`.

## Parallel Work Pattern

Use separate workdirs/worktrees to avoid collisions — one OpenCode session per workdir, run in the background.

## Session & Cost Management

List past sessions with `opencode session list`. Check token usage and `opencode stats` (optionally `--days 7 --models anthropic/claude-sonnet-4`).

## Pitfalls

- Interactive `opencode` (TUI) sessions require `pty=true`. `opencode run` does NOT need pty.
- `/exit` is NOT a valid command — it opens an agent selector. Use Ctrl+C to exit the TUI.
- PATH mismatch can select the wrong OpenCode binary/model config.
- If OpenCode appears stuck, inspect logs before killing.
- Avoid sharing one working directory across parallel OpenCode sessions.
- Enter may need to be pressed twice to submit in the TUI.

## Verification

Smoke test:

```
opencode run 'Respond with exactly: OPENCODE_SMOKE_OK'
```

Success criteria: output includes `OPENCODE_SMOKE_OK`, command exits without provider/model errors, and for code tasks the expected files change and tests pass.

## Rules

1. Prefer `opencode run` for one-shot automation — simpler, no pty.
2. Use interactive background mode only when iteration is needed.
3. Always scope OpenCode sessions to a single repo/workdir.
4. For long tasks, provide progress updates from process logs.
5. Report concrete outcomes (files changed, tests, remaining risks).
6. Exit interactive sessions with Ctrl+C or kill, never `/exit`.

## Prompt Preparation Checklist

When preparing the coding agent instruction for OpenCode:

- State the desired code outcome clearly and concretely.
- Tell OpenCode to inspect the repository context before editing files.
- Include any file, behavior, or test hints that reduce ambiguity.
- Prefer precise change requests over broad open-ended prompts.
- Ask for a compact final report: changes made, validation run, remaining concerns.
