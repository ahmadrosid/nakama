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

Bash defaults to the **profile workspace**. Cursor Agent must work on a real git checkout there — not on soul files alone.

1. Identify the target repo (URL or folder name from the user). If unclear, ask once.
2. Check whether that repo already exists under the workspace (`ls`, or `test -d <dir>/.git`).
3. If it is missing, clone it into the workspace (`git clone <url> <dir>`), then continue.
4. Hand off soon: give Cursor a short brief (issue URL + goal + constraints). Do not fully re-solve the bug with file tools first.

Do not invent a repo URL. Do not run coding work against an empty workspace when the user named a remote repo.

## Command (required shape)

Set bash **`cwd`** to the repo directory. Keep argv0 as **`agent`** — never `cd … && agent` (with `codingAgent: true`, Nakama requires the harness binary first).

```bash
agent -p 'Implement the requested change and summarize what you verified' --output-format text --yolo
```

bash args:

- `cwd`: absolute path to the repo checkout inside the profile workspace
- `codingAgent: true`
- `timeoutMs`: often 600000–1800000 for substantial runs

Flags:

- `-p` / `--print` — non-interactive one-shot
- `--output-format text` — short final answer for Nakama (preferred). `stream-json` also works: Nakama summarizes the NDJSON into assistant/tools/result and saves the full log under `artifacts/coding-agent-runs/`.
- `--yolo` — required for unattended background dispatch

## Commits and pull requests

Cursor Agent can create branches, commit, push, and open GitHub PRs with `git` + `gh` on the host (same capabilities as a local checkout). Include that in the `-p` brief when the user wants an issue resolved, a fix shipped, or a PR opened — do not stop at uncommitted edits on `main`.

When shipping / opening a PR, put this in the agent prompt (adapt issue number, title, and scope):

```bash
agent -p 'Fix issue #175: <short problem + required changes>.

When done:
1. Create a feature branch off the default branch (do not commit on main).
2. Commit with a clear message focused on why.
3. Push the branch and open a PR with gh (link Fixes #175 in the body).
4. Reply with the PR URL, what changed, and what you verified.

Do not force-push. Do not skip hooks.' --output-format text --yolo
```

Rules:

- Only require commit/push/PR when user intent includes shipping (fix an issue, open a PR, ship, create a PR). For local-only exploration or “just look”, skip git publish steps.
- Prefer one coding-agent run that implements **and** opens the PR. If the first run left uncommitted work, follow up with another `agent -p` (or bash `gh`/`git`) in the same repo `cwd` to finish ship — verify with `git status` / `gh pr view` first.
- Host needs `gh` authenticated for the target remote. If push/PR fails on auth, tell the user to fix host `gh auth` / git credentials, then retry.
- Never invent a PR URL. Confirm from agent stdout or `gh pr list` / `gh pr view`.

## After the run

- Summarize the returned stdout for the user (already summarized if stream-json was used).
- If the result is unclear, verify completion with `git status` / `git diff --stat` in the repo (via bash `cwd`), then report what changed. Use the full log path from stdout when you need raw events.
- If a PR was requested: confirm branch is pushed and report the PR URL (from stdout or `gh pr view --json url -q .url`). If changes exist but no PR, finish shipping — do not claim the issue is done.
- If the run failed (non-zero exit, timeout, auth error, or empty useful output), explain clearly and ask the user to fix host install/auth when that is the cause.
