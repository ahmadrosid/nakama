---
name: verify-bs
description: >-
  Verify the current UI change in BrowserOS (browseros-neo MCP) on a dev app
  this session starts from its own worktree, on its own ports, with the user's
  ~/.nakama data. Use when the user says /verify-bs, "verify using browseros",
  or asks to see a web change working in the real app.
---

# Verify in BrowserOS on this session's own dev app

Each session runs its own API and Vite from its own worktree, so several
sessions can check changes at the same time. All of them use the user's
`~/.nakama` data. Do not use `agent:ui`, Playwright or the built-in browser.
Do not use or stop the user's own app on 3003 / 4310.

## Steps

1. **Find what to check.** Read the diff (`git diff main...HEAD` plus
   uncommitted changes). Name the screen, the route, and the 1–3 states the
   change touches. Find the route in `apps/web/src/App.tsx`.
2. **Get a worktree on the code to check.** Use this session's worktree if it
   has one. Else `git worktree add ../nakama-verify-<branch> <branch>`. A
   branch can be checked out in one worktree only; if another has it, use
   `git worktree add --detach <path> <branch>`. New worktree: run
   `bun install` in it first. Never switch the branch of a checkout that is
   not yours.
3. **Pick two free ports.** Web from 3010 up, API from 4311 up. A port is
   free only when both are empty:
   `lsof -nP -iTCP:<port> -sTCP:LISTEN` and
   `curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://localhost:<port>/`
   (prints `000`).
4. **Start the API** in the background from the worktree root. Do not use
   `bun run dev:server`: it kills whatever listens on 4310, which is the
   user's API.

   ```bash
   set -a; . ~/.config/nakama/dev-secrets.env; set +a
   NAKAMA_CONFIG_DIR=$HOME/.nakama NAKAMA_PORT=<api> bun run apps/server/src/index.ts
   ```

   Ready when the log says `Nakama server listening on http://127.0.0.1:<api>`.
5. **Start Vite** in the background from `apps/web`:

   ```bash
   NAKAMA_SERVER_URL=http://127.0.0.1:<api> bun x vite --port <web> --strictPort
   ```

   Ready when `http://localhost:<web>/` returns 200. A "Port is already in
   use" error: pick the next port and start again.
6. **Open BrowserOS.** Load the `browseros-neo` tools. `name_session` (category
   `testing-and-qa`), `tabs action="list"`, then `tabs action="new"` with
   `http://localhost:<web>/<route>`. Never work in the user's own tabs.
   Cookies on `localhost` are shared across ports, so the user's login
   carries over.
7. **Drive it.** `snapshot mode="interactive"` → `act` by ref → `screenshot`
   for each state. Wait with `wait for="text"`, not a fixed pause.
8. **Do what the check needs.** Save, create, edit, send or delete when the
   goal needs it; no need to ask first. The app uses the user's real
   `~/.nakama` data, so:
   - Prefer test records you create (name them `verify-bs …`) and clean them
     up at the end.
   - Report every write you made to the user's existing data.
   - Close any tab the app opened in your group (for example an OAuth page).
9. **Stop your servers** when the check is done, unless the user wants them
   kept: stop the two background tasks you started. Every API on
   `~/.nakama` also manages the same background workers (channels,
   automations) and writes `~/.nakama/runtime/server-url.txt`, so do not
   leave one running.
10. **Report.** Numbered list: each state checked, pass or fail, one line
    each. Give the URL you used. List the data you changed. Name what you
    did not check and why. Keep your BrowserOS tab open.

## Notes

- Built-in plugin changes (`packages/plugins/*`) show only after the plugin is
  reinstalled on your dev app.
- The service worker does not run under Vite dev, so the "Notify me when a
  reply is ready" switch stays disabled there.
- A bug you find: say what you saw and where; fix it only if the user asks.
