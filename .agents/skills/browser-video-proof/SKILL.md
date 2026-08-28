---
name: browser-video-proof
description: >-
  Produce H.264 MP4 browser video proof for a UI fix, upload it to GitHub
  user-attachments, and put the URL in a PR description. Use for scroll/
  layout/interaction proofs (e.g. /automations expanded-run scrolling),
  recorded E2E demos, or when a reviewer needs visual evidence on a PR.
---

# Browser video proof for PRs

Record a short, playable browser video that proves a UI fix, attach it to the
PR description, and verify the live body. Do not change application code for
the recording unless the user explicitly asks.

Reference run: PR #723 (`/automations` expanded long-run scroll).

## Prerequisites

- `gh` authenticated with push access to the target repo
- Bun + repo deps installed in the worktree (`bun install`)
- Google Chrome (or Chromium) on the host
- `ffmpeg` on PATH (for webm → H.264 MP4)
- Playwright in an isolated dir under `/tmp` (do not add it to the repo):

```bash
mkdir -p /tmp/<run>/playwright
cd /tmp/<run>/playwright
npm i playwright
npx playwright install ffmpeg
```

## Process

### 1. Isolate with a git worktree

Keep the main checkout clean.

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin main
git worktree add -b <branch> .worktrees/<slug> origin/main   # or attach to the fix branch
cd .worktrees/<slug>
```

Work only inside that worktree for servers and recording.

### 2. Inspect fixtures and UI first

Before inventing data:

1. Read the page under test (labels, expand controls, scroll containers).
2. Check existing test fixtures / factories for the same feature.
3. Prefer seeding via the public HTTP API. Fall back to a one-off SQLite insert
   in an isolated `NAKAMA_CONFIG_DIR` only when no API can create the needed row
   (e.g. a completed automation run with huge `output`).

### 3. Seed deterministic tall content

For scroll / overflow proofs, the fixture must be taller than the pane.

- Put a unique top marker near the start: `SCROLL_PROOF_MARKER_TOP`
- Put a unique bottom marker at the end: `SCROLL_PROOF_MARKER_BOTTOM`
- Use enough body text that `scrollHeight - clientHeight` is large (thousands of px)

Example shape for run output:

```markdown
# SCROLL_PROOF_MARKER_TOP — long automation run output

## Section 1
...

## Section 80
...

# SCROLL_PROOF_MARKER_BOTTOM — end of tall content
```

Never seed into the operator's real `~/.nakama` data. Always use a fresh
`NAKAMA_CONFIG_DIR` under `/tmp/<run>/`.

### 4. Start isolated local servers

Pick free ports. Do not steal the default stack if something already listens
on 4310 / 3000 / 3003.

```bash
RUN=/tmp/<run>
API_PORT=4330
WEB_PORT=3014
mkdir -p "$RUN/nakama-data" "$RUN/logs"

# Keep processes alive after the shell exits (plain nohup ... & dies here)
setsid nohup env NAKAMA_CONFIG_DIR="$RUN/nakama-data" NAKAMA_PORT=$API_PORT \
  bun run apps/server/src/index.ts \
  >"$RUN/logs/server.log" 2>&1 < /dev/null &

setsid nohup env VITE_API_URL="http://127.0.0.1:${API_PORT}" \
  bun run --cwd apps/web dev -- --host 127.0.0.1 --port $WEB_PORT \
  >"$RUN/logs/web.log" 2>&1 < /dev/null &
```

Wait until `curl -sf http://127.0.0.1:$API_PORT/health` succeeds and the web
origin responds. Fresh setup: `POST /v1/auth/setup`, then create provider /
profile / automation (or reuse fixtures) with `Cookie` + `X-CSRF-Token` +
`X-Org-Id`.

### 5. Record with Playwright (H.264 MP4)

Scaffold the recorder under `/tmp/<run>/` only. Never commit it.

```js
const browser = await chromium.launch({
  channel: "chrome", // if Chrome is installed
  headless: false,
  args: ["--disable-gpu"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: rawDir, size: { width: 1440, height: 900 } },
});
```

Rules:

1. Drive the real UI path under test (role/text locators).
2. Make motion visible — mouse wheel or stepped scroll, not a single invisible jump only.
3. Assert scroll moved (`scrollTop` delta) and that the bottom marker becomes reachable.
4. Capture `page.video()?.path()` before `context.close()`.
5. Convert: `ffmpeg -y -i in.webm -c:v libx264 -pix_fmt yuv420p out.mp4`
6. Write `results.json` + before/after screenshots under `artifacts/e2e-<id>/`.

WebM alone is not enough for GitHub playback. Ship H.264 + `yuv420p`.

### 6. Validate the video before claiming anything

```bash
ffprobe -v error -show_entries stream=codec_name,width,height \
  -show_entries format=duration -of json out.mp4
# Extract early / late frames and look at them
ffmpeg -y -ss 00:00:02 -i out.mp4 -vframes 1 frame-early.png
ffmpeg -y -ss 00:00:08 -i out.mp4 -vframes 1 frame-late.png
```

Pass only if:

- codec is `h264`
- duration is long enough to see the interaction
- early frame shows the start state (e.g. top marker / expanded pane)
- late frame shows scroll progress (bottom marker or advanced sections)
- `results.json` reports a real `scrollTop` delta (or equivalent proof metric)

### 7. Upload to GitHub user-attachments

Undocumented but token-auth works for images/video when you have push access:

```bash
TOKEN=$(gh auth token)
REPO_ID=$(gh api repos/<owner>/<repo> --jq .id)
MP4=artifacts/e2e-<id>/<name>.mp4

UPLOAD_JSON=$(curl -sS -X POST \
  "https://uploads.github.com/user-attachments/assets?name=$(basename "$MP4")&repository_id=${REPO_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: video/mp4" \
  -H "Accept: application/vnd.github+json" \
  --data-binary @"${MP4}")

VIDEO_URL=$(printf '%s' "$UPLOAD_JSON" | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).url)')
echo "$VIDEO_URL"  # https://github.com/user-attachments/assets/<uuid>
```

Save the URL. Confirm a HEAD/GET on the asset returns a video content type.

### 8. Update the PR description

Add a short **Browser proof** section with the steps shown and the bare
`https://github.com/user-attachments/assets/...` URL on its own line (GitHub
embeds the player). Prefer writing the body via a file:

```bash
gh api repos/<owner>/<repo>/pulls/<n> --method PATCH --input body.json
# or: gh pr edit <n> --body-file /tmp/pr-body.md
```

Follow `.agents/skills/adhd-pr-description/SKILL.md` for the rest of the body.

### 9. Verify the live PR body

```bash
gh api repos/<owner>/<repo>/pulls/<n> --jq .body | rg 'user-attachments/assets/<uuid>|Browser proof'
```

Do not report success until this check passes.

## Example: automations expanded-run scroll

1. Worktree on the fix branch (or docs-only branch for this skill).
2. Isolated API `4330` + web `3014`, fresh `NAKAMA_CONFIG_DIR`.
3. `POST /v1/auth/setup` → provider → create automation **Long output digester**.
4. Insert/complete one run whose `output` is the long markdown with
   `SCROLL_PROOF_MARKER_TOP` / `SCROLL_PROOF_MARKER_BOTTOM`.
5. Playwright: open `/automations` → select the automation → **Expand run** →
   wheel-scroll the detail pane until the bottom marker is in view.
6. Convert to H.264 MP4, inspect frames, upload, patch PR body, verify.

## Cleanup

1. Kill the isolated API/web listeners on the ports you chose.
2. Leave `/tmp/<run>/` and profile `artifacts/e2e-<id>/` as local evidence
   (do not commit videos or recorder scripts).
3. Remove the worktree when the branch is merged or abandoned:
   `git worktree remove .worktrees/<slug>`

## Honesty rules

1. Never claim browser proof without watching frames or `ffprobe` + screenshots.
2. Never paste a `user-attachments` URL you did not upload and re-fetch from the live PR body.
3. Never treat a green unit test as a substitute for the video when the ask was visual proof.
4. If scroll did not move, markers are wrong, or the MP4 is empty/corrupt — say it failed. Do not soften.
5. Do not modify application code “to make the video easier” unless the user asked for a product fix.
6. Do not touch the operator’s real Nakama config dir.
