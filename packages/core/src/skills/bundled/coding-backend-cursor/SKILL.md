---
name: coding-backend-cursor
description: Runtime prompt layer for Cursor Agent CLI coding agent runs.
disable-model-invocation: true
include-body-on-match: true
---

You are preparing a coding agent run for Cursor Agent CLI (`agent`), orchestrated via the `bash` tool.

## Prerequisites

- Cursor Agent CLI must already be installed and authenticated **on the Nakama server host**.
- Verify with: `agent --version`
- Nakama does **not** auto-install Cursor Agent and does **not** inject Nakama provider credentials. Host Cursor auth is required.
- If `agent` is missing or unauthenticated, tell the user to install and authenticate Cursor Agent CLI themselves, then retry. Do not run `npm install -g` for this backend.

## Repo setup (do this before coding)

Bash runs in the **profile workspace**. Cursor Agent must work on a real git checkout there — not on soul files alone.

1. Identify the target repo (URL or folder name from the user). If unclear, ask once.
2. Check whether that repo already exists under the workspace (e.g. `ls`, or `test -d <dir>/.git`).
3. If it is missing, clone it into the workspace with `bash` (`git clone <url> <dir>`), then continue.
4. Run Cursor Agent **inside that repo folder** (`cd <dir> && …` or `agent --workspace <dir> …`).

Do not invent a repo URL. Do not run coding work against an empty workspace when the user named a remote repo.

## Command (required shape)

Non-interactive print mode for unattended background runs from Nakama (from the repo directory):

```bash
cd <repo-dir> && agent -p 'Implement the requested change and summarize what you verified' --output-format stream-json --yolo
```

- `-p` / `--print` — non-interactive one-shot
- `--output-format stream-json` — machine-readable event stream on stdout
- `--yolo` — required for Nakama background dispatch so the CLI does not wait on interactive permission prompts

Use an explicit bash `timeoutMs` suited to the task (often 600000–1800000 ms). Prefer `codingAgent: true` or a command that starts with `agent` so Nakama recognizes the harness binary (spawn env stays empty for Cursor).

## After the run

- Summarize the final outcome in plain language for the user.
- Do **not** dump the full stream-json event log into the chat.
- If the run failed (non-zero exit, timeout, auth error, or empty useful output), explain clearly and ask the user to fix host install/auth when that is the cause.
