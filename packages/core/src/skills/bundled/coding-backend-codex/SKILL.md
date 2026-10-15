---
name: coding-backend-codex
description: Runtime prompt layer for Codex coding agent runs.
disable-model-invocation: true
include-body-on-match: true
---

Use Codex for coding tasks when the Coding Agent Harness context selects it. Follow that context's command template and run it through Nakama's `bash` tool with `codingAgent: true`, `cwd` set to the target project, and a task-appropriate `timeoutMs`.

## Prerequisites

- Install Codex on the Nakama host if needed: `npm install -g @openai/codex`.
- Authenticate with `codex login` or configure `OPENAI_API_KEY`. A missing API key does not imply that CLI login is missing.
- Check `codex --version` and `codex login status` when installation or auth is uncertain.

## One-shot coding

`codex exec` is non-interactive and works with Nakama's pipe-based `bash` tool. Do not request a PTY or use an interactive `codex` session there.

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --color never 'Make the requested change, run targeted checks, and summarize the result.'
```

Use `--dangerously-bypass-approvals-and-sandbox` only when the operator has authorized full host access, as in this setup. Do not use `codex exec --full-auto`: Codex rejects that option. Do not use `codex exec -- --full-auto` either: `--` makes `--full-auto` prompt text, not an option. If a run fails with `unexpected argument '--full-auto'`, correct the command and retry the task.

`--skip-git-repo-check` permits scratch work outside a git repository; it does not replace setting `cwd` to the right project for repo changes. Put the task prompt in one shell argument and quote it safely.

## Reviews

From the target repository, use `codex review --base origin/main` for branch changes or `codex review --uncommitted` for local edits. Keep review work read-only unless the user asked for fixes.

## After the run

Check the `bash` exit code and timeout result. Verify changed files and targeted tests before reporting success. For implementation tasks, follow the `coding-agent` skill's branch, commit, push, and PR instructions unless the user requested local-only work.
