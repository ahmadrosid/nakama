---
name: verify-bs
description: >-
  Verify the current UI change in BrowserOS (browseros-neo MCP) on the user's
  dev app at http://localhost:3003. Use when the user says /verify-bs,
  "verify using browseros", "check it on 3003", or asks to see a web change
  working in the real app.
---

# Verify in BrowserOS on localhost:3003

Check the change on the user's own dev app. Do not use `agent:ui`, Playwright,
the built-in browser, or a new Vite/server instance.

## Steps

1. **Find what to check.** Read the diff (`git diff main...HEAD` plus
   uncommitted changes). Name the screen, the route, and the 1–3 states the
   change touches. Find the route in `apps/web/src/App.tsx`.
2. **Check the app is up.** `lsof -iTCP:3003 -sTCP:LISTEN`. Port 3003 is the
   user's Vite (`apps/web`); it proxies the API on `127.0.0.1:4310`.
   - 3003 down: tell the user; do not start it yourself.
   - 3003 gives 502: the API is down. Start it in the background with
     `NAKAMA_PORT=4310 bun run dev:server`.
   - Vite serves the current checkout, so the branch you are on is what shows.
3. **Open BrowserOS.** Load the `browseros-neo` tools. `name_session` (category
   `testing-and-qa`), `tabs action="list"`, then `tabs action="new"` with
   `http://localhost:3003/<route>`. Never work in the user's own tabs.
4. **Drive it.** `snapshot mode="interactive"` → `act` by ref → `screenshot`
   for each state. Wait with `wait for="text"`, not a fixed pause.
5. **Stay read-only.** The app uses the user's real `~/.nakama` data.
   - Do not click Save, Remove, Send, or anything that writes, unless the
     change needs it and the user said yes.
   - A flow that starts and can be cancelled (sign-in, dialog) is fine: cancel
     it at the end.
   - Close any tab the app opened in your group (for example an OAuth page).
6. **Report.** Numbered list: each state checked, pass or fail, one line each.
   Name what you did not check and why. Keep your BrowserOS tab open.

## Notes

- Built-in plugin changes (`packages/plugins/*`) show only after the plugin is
  reinstalled on 3003.
- A bug you find: say what you saw and where; fix it only if the user asks.
