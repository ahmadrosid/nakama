# How to capture docs screenshots

Screenshots for the docs site live in `docs/website/public/screenshots/`. MDX pages use them as `![alt](/screenshots/name.png)`.

Always capture from an isolated demo server. Never use your real instance (for example `:3003` or `:4310`), because it shows real chat titles, names, and keys.

## Before you start

1. Install the tools:
   - Bun 1.4+
   - `agent-browser` on `PATH` (`npm i -g agent-browser && agent-browser install`)
2. Run `bun install` at the repo root.
3. Run the scripts outside the sandbox. They bind ports, start PM2 workers, and open a browser.

## Use a script when one exists

Each `docs/website/scripts/capture-*.sh` script does these steps:

1. Builds `apps/web` (`ensure_current_web_build` in `capture-common.sh`).
2. Starts the server with a temp `NAKAMA_CONFIG_DIR` under `/tmp` on its own port.
3. Seeds over HTTP: `POST /v1/auth/setup` with the **Docs Demo** org (`admin@docs.demo`), then a provider with a placeholder key.
4. Copies the session cookies into an `agent-browser` session.
5. Drives the UI and writes PNGs into `public/screenshots/`.
6. Deletes the temp config and stops the server on exit.

Run a script from `docs/website`:

```bash
bun run screenshots:chat
```

| Script | Port | Images |
| --- | --- | --- |
| `capture-setup-screenshots.sh` (`screenshots`) | 4312 | `setup-step-*` |
| `capture-chat-screenshots.sh` (`screenshots:chat`) | 4313 | `chat-light`, `chat-dark` |
| `capture-mcp-screenshots.sh` (`screenshots:mcp`) | 4314 | `mcp-exa-api-key` |
| `capture-self-improving-skills-screenshots.sh` (`screenshots:self-improving-skills`) | 4315 | `skill-write-approval-*` |
| `capture-skill-version-history-screenshots.sh` | 4316 | `skill-version-*` |
| `capture-telegram-screenshots.sh` (`screenshots:telegram`) | 4316 | `telegram-*` |
| `capture-error-tracking-screenshots.sh` (`screenshots:error-tracking`) | 4317 | `error-tracking-*` |
| `capture-acp-agents-screenshots.sh` | 4319 | `acp-*` |

Scripts without a `package.json` entry run directly: `./scripts/capture-acp-agents-screenshots.sh`.

Run scripts one at a time. Two of them share port 4316, and each one rebuilds `apps/web`.

## When a script fails

Most failures are `✗ Element not found` or `Missing ... button`. The UI changed under the script.

1. Read the last lines of the log to find the failing step.
2. Find the new markup in `apps/web/src` (search for the label text).
3. Change the selector in the script. Prefer stable hooks: `#id`, `aria-label`, role + exact name, or exact button text.
4. If a control is behind a disclosure (for example **Change** or **Customize**), click it first, then `wait "<selector>"` before you use the control.
5. Run the script again and look at the PNG. A script can pass and still capture the wrong part of the page.

## Capture an image that has no script

Copy the script flow by hand:

1. Start a server with a temp config dir and a free port (not 4310 or 4312–4319):

   ```bash
   NAKAMA_CONFIG_DIR=/tmp/nakama-docs-manual NAKAMA_PORT=4330 bun run apps/server/src/index.ts
   ```

2. Seed it with `curl`, as the scripts do: `POST /v1/auth/setup` (Docs Demo org), then `POST /v1/providers`. Send `X-Org-Id` and `X-CSRF-Token` on later calls.
3. Seed the data the shot needs:
   - Artifacts: write files into `$NAKAMA_CONFIG_DIR/orgs/<orgId>/profiles/<profileId>/artifacts/`.
   - Custom tools: put the module in `$NAKAMA_CONFIG_DIR/orgs/<orgId>/tools/`, then `POST /v1/tools`.
   - Channel bots (Telegram, Discord): save config with the `packages/core` helpers in a `bun -e` call. Saving through HTTP checks the token with the real service and fails on a fake token.
4. Set the cookies in `agent-browser`, then open the page and take the shot:

   ```bash
   agent-browser --session docs-manual set viewport 1280 800
   agent-browser --session docs-manual set media light
   agent-browser --session docs-manual open http://127.0.0.1:4330/files?view=artifacts
   agent-browser --session docs-manual screenshot docs/website/public/screenshots/name.png
   ```

   For a 2x image, pass a scale: `set viewport 1440 900 2`.
5. Stop the server and its PM2 daemon. The daemon runs from `PM2_HOME`. If you did not set it, check `ps` for a `pm2` process that uses your temp config dir.

## Replace an existing image

1. Keep the file name. Then the MDX does not change.
2. Keep the pixel size and the theme (light or dark) of the old image:

   ```bash
   sips -g pixelWidth -g pixelHeight docs/website/public/screenshots/name.png
   ```

3. Read the caption and the steps around the image. If they name UI that is gone, change that text in the same PR.
4. Leave images with no dashboard UI as they are (public share page, cropped panels, setup wizard), unless their content changed.

## Check before you open a PR

Run from `docs/website`:

```bash
bun run check:pipeline
```

```bash
bun run build
```

`check:pipeline` fails when an MDX page uses a missing image, or when a script writes an image that does not exist.
