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
codex --ask-for-approval never exec --skip-git-repo-check --sandbox workspace-write --color never 'Make the requested change, run targeted checks, and summarize the result.'
```

`--ask-for-approval` is a **top-level** option and must come before `exec`. `--skip-git-repo-check` permits scratch work outside a git repository; it does not replace setting `cwd` to the right project for repo changes. Put the task prompt in one shell argument and quote it safely.

If workspace sandbox setup fails on the host, report the error. Use `--sandbox danger-full-access` only when the operator has authorized running Codex with the host process's full filesystem access.

## Reviews

From the target repository, use `codex review --base origin/main` for branch changes or `codex review --uncommitted` for local edits. Keep review work read-only unless the user asked for fixes.

## After the run

Check the `bash` exit code and timeout result. Verify changed files and targeted tests before reporting success. For implementation tasks, follow the `coding-agent` skill's branch, commit, push, and PR instructions unless the user requested local-only work.
