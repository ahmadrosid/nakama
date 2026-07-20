---
name: agent-browser
description: Use when the user needs interactive browser automation — login to websites, fill forms, click through pages, scrape login-walled or client-rendered content, or drive a real browser. Do not use for ordinary public-page reading or open-ended research without interaction.
include-body-on-match: true
---

Use this skill when the task needs a **real browser**: login walls, forms, multi-step UI, or pages that `web_fetch` / `web_search` cannot reach.

Keep ordinary web work local:

- Use `web_fetch` for a single public HTTP(S) page that does not require login or interaction.
- Use `web_search` to discover sources.
- Do not open a browser just to read a public doc page.

## Prerequisites

- This profile must have the **`bash`** tool assigned.
- The host must have the [agent-browser](https://github.com/vercel-labs/agent-browser) CLI and Chrome installed:

```bash
npm install -g agent-browser
agent-browser install
```

If `bash` returns `command not found`, `ENOENT`, or similar for `agent-browser`, tell the operator to run the install commands above (and `agent-browser install --with-deps` on Linux if Chrome libraries are missing). Do not invent a different browser tool.

## Browser workflow

Drive the browser with the `bash` tool. Multiple `agent-browser` commands in the **same agent run** share one daemon session — that is how login → navigate → act stays coherent.

1. Open the target (or launch without a URL if you must set cookies first):

```bash
agent-browser open https://example.com/login
```

2. Snapshot for token-efficient element refs (prefer interactive/ref output):

```bash
agent-browser snapshot -i
```

3. Act by ref from the snapshot (`@e1`, `@e2`, …). Re-snapshot after navigation or major UI changes — stale refs fail:

```bash
agent-browser fill @e3 "user@example.com"
agent-browser fill @e4 "secret"
agent-browser click @e5
agent-browser press Enter
```

4. Wait when the UI is loading:

```bash
agent-browser wait --load networkidle
```

5. Optional screenshot — write under the profile workspace `artifacts/` directory (bash cwd is the profile workspace). Prefer meaningful names; avoid capturing password fields:

```bash
agent-browser screenshot artifacts/browser-page.png
```

6. When the task is done (success or give-up), **close** the session so the next run starts fresh:

```bash
agent-browser close
```

If the daemon looks stuck, `agent-browser close --all` or `agent-browser doctor` can help.

### Timeouts

Default `bash` timeout is short. For browse/login steps, pass an explicit `timeoutMs` (tens of seconds to a few minutes per command as needed). Prefer one focused command per `bash` call so failures are easy to read.

### Session policy (v1)

- **Within one run:** reuse the same agent-browser daemon (do not close between every click).
- **Across runs:** do **not** use `--restore`, `state load`, or persistent Chrome profiles unless the user explicitly asks in this conversation. Re-authenticate when the task requires it.
- Always `close` at the end of the browser work in this run.

### Credentials

- Prefer credentials the user supplied in the prompt or already stored for this task.
- Do not echo passwords or session tokens in your final summary.
- Avoid screenshots of password fields.

### After the run

- Summarize what you did and what you learned in plain language.
- If a command failed (non-zero exit, timeout, missing CLI), explain clearly and either retry with a fresh snapshot or ask the user / operator for help.
