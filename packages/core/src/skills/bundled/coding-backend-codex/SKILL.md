---
name: coding-backend-codex
description: Runtime prompt layer for Codex coding agent runs.
disable-model-invocation: true
include-body-on-match: true
---

You are preparing a coding agent run for [Codex](https://github.com/openai/codex), OpenAI's autonomous coding agent CLI, orchestrated via terminal/process tools.

## When to Use

- Building features
- Refactoring
- PR reviews
- Batch issue fixing

Requires the Codex CLI and a git repository.

## Prerequisites

- Codex installed: `npm install -g @openai/codex`.
- OpenAI auth configured: either `OPENAI_API_KEY` or Codex OAuth credentials from the Codex CLI login flow.
- **Must run inside a git repository** — Codex refuses to run outside one.
- Use `pty=true` in terminal calls — Codex is an interactive terminal app.

A valid CLI OAuth session may live under `~/.codex/auth.json`; do not treat a missing `OPENAI_API_KEY` alone as proof that Codex auth is missing.

## One-Shot Tasks

```
codex exec 'Add dark mode toggle to settings'
```

For scratch work (Codex needs a git repo):

```
cd $(mktemp -d) && git init && codex exec 'Build a snake game in Python'
```

## Background Mode (Long Tasks)

```
# Start in background with PTY — returns a session id
codex exec --full-auto 'Refactor the auth module'

# Monitor progress
process(action="poll", session_id="<id>")
process(action="log", session_id="<id>")

# Send input if Codex asks a question
process(action="submit", session_id="<id>", data="yes")

# Kill if needed
process(action="kill", session_id="<id>")
```

## Key Flags

| Flag | Effect |
|------|--------|
| `exec "prompt"` | One-shot execution, exits when done |
| `--full-auto` | Sandboxed but auto-approves file changes in workspace |
| `--yolo` | No sandbox, no approvals (fastest, most dangerous) |
| `--sandbox danger-full-access` | No Codex sandbox; useful when the host service context breaks bubblewrap |

## Sandbox Caveat

When invoking the Codex CLI from a service/gateway context, Codex `workspace-write` sandboxing may fail even when the same command works in an interactive shell. A typical symptom is bubblewrap/user-namespace errors such as `setting up uid map: Permission denied` or `loopback: Failed RTM_NEWADDR: Operation not permitted`.

In that context, prefer:

```
codex exec --sandbox danger-full-access "<task>"
```

Use process boundaries as the safety layer instead: explicit `workdir`, clean git status before launch, narrow task prompts, `git diff` review, targeted tests, and confirmation before committing broad changes.

## PR Reviews

Clone to a temp directory for safe review:

```
REVIEW=$(mktemp -d) && git clone https://github.com/user/repo.git $REVIEW && cd $REVIEW && gh pr checkout 42 && codex review --base origin/main
```

## Parallel Issue Fixing with Worktrees

```
# Create worktrees
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

# Launch Codex in each (background, pty)
codex --yolo exec 'Fix issue #78: <description>. Commit when done.'   # workdir=/tmp/issue-78
codex --yolo exec 'Fix issue #99: <description>. Commit when done.'   # workdir=/tmp/issue-99

# After completion, push and create PRs
cd /tmp/issue-78 && git push -u origin fix/issue-78
gh pr create --repo user/repo --head fix/issue-78 --title 'fix: ...' --body '...'

# Cleanup
git worktree remove /tmp/issue-78
```

## Batch PR Reviews

```
# Fetch all PR refs
git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'

# Review multiple PRs in parallel
codex exec 'Review PR #86. git diff origin/main...origin/pr/86'   # background
codex exec 'Review PR #87. git diff origin/main...origin/pr/87'   # background

# Post results
gh pr comment 86 --body '<review>'
```

## Rules

1. **Always use `pty=true`** — Codex is an interactive terminal app and hangs without a PTY.
2. **Git repo required** — Codex won't run outside a git directory. Use `mktemp -d && git init` for scratch.
3. **Use `exec` for one-shots** — `codex exec "prompt"` runs and exits cleanly.
4. **`--full-auto` for building** — auto-approves changes within the sandbox.
5. **Background for long tasks** — use `background=true` and monitor with the `process` tool.
6. **Don't interfere** — monitor with `poll`/`log`, be patient with long-running tasks.
7. **Parallel is fine** — run multiple Codex processes at once for batch work.

## Prompt Preparation Checklist

When preparing the coding agent instruction for Codex:

- Be explicit about the concrete code change to make.
- Tell Codex to inspect the repo before changing code.
- Ask for targeted verification after edits.
- Prefer concise, execution-oriented instructions over long framing.
- Expect a short final summary covering changes, verification, and remaining risks.
