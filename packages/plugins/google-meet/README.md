# Google Meet transcription

Transcripts save automatically as text files in the organization's plugin data folder under `transcripts/`. Open **Saved transcripts** to view them; downloading a copy to your computer is optional. Existing meeting transcripts are exported automatically when the updated plugin runs.

Join Google Meet as a silent participant and save a live transcript using OpenAI `gpt-transcribe`. BetterWright handles the browser and persistent Google sign-in. The chat provider is independent; transcription needs a separately billed OpenAI API key. Raw audio is not retained.

## Setup

1. Run the current Nakama Linux Docker image. In **Plugins → Google Meet → Install**, review the required dependencies and choose **Install dependencies and plugin**. A platform admin performs the shared runtime setup; org admins can install the plugin once dependencies are ready. The dialog shows Linux packages, SDKs, browser download and verification separately. A failed step offers **Retry** and does not enable the plugin.

   The default image includes only a restricted installer, not the meeting runtime. It installs a fixed list of Debian packages through a root-owned, no-argument sudo helper. BetterWright and CloakBrowser download as the ordinary Nakama user, with npm install scripts disabled. SDKs and the browser cache live under `NAKAMA_CONFIG_DIR/runtimes/google-meet`; Google profiles and transcripts remain organization-specific. Linux packages live in the container filesystem: after replacing the container, use **Reinstall** to restore missing packages and reuse cached downloads. A read-only container or `no-new-privileges` blocks this installer.

   For a manually managed Linux host, install the prerequisites separately:
   ```sh
   sudo apt-get install chromium xvfb ffmpeg pulseaudio pulseaudio-utils fonts-liberation
   mkdir -p /opt/nakama-meet
   cd /opt/nakama-meet
   bun add --exact --production --ignore-scripts betterwright@2.8.1
   ```
   Set `NAKAMA_MEET_CHROME=/usr/bin/chromium` on the Nakama server. Alternatively install BetterWright's managed browser and set `BETTERWRIGHT_CHROMIUM_PATH` to its executable. `NAKAMA_MEET_BETTERWRIGHT_PATH` can point to another installed SDK's absolute `dist/src/index.js` path. The SDK must retain its dependencies and sibling files; it cannot be bundled into `meet.js` alone.

   `--build-arg INSTALL_MEET_DEPS=true` still preinstalls the legacy Chromium/BetterWright runtime for operators who prefer it. The guided installer downloads CloakBrowser separately. Run as a non-root user with Chromium sandbox support. Each browser gets its own virtual display and each meeting gets its own PulseAudio sink.
2. The plugin installs after dependency verification. Start its worker in **Workers** if it is stopped. If the page was closed during the download, reopen installation to check progress and finish installing the plugin.
3. Open **Google Meet → Settings**, save your OpenAI API key, and select **Connect Google**. Open the sign-in browser, complete Google login and any MFA, then select **Finish sign-in**. The viewer closes and the browser profile persists in this organization's plugin data. Google may reject browser automation; BetterWright does not guarantee acceptance or bypass account policies. Existing cookie JSON imports must reconnect once.
4. Paste a Meet URL and choose the maximum duration, or ask an agent with the plugin tools assigned to join. Tell participants before transcribing. The host may need to admit the bot.

**Disconnect Google** closes the viewer and deletes the local Google browser profile. It does not revoke Google sessions on other devices. Leave any active meeting before changing Google login. The viewer expires after ten minutes and is never opened during a meeting. Connect/finish/disconnect and viewer URLs are restricted to org admins and are not exposed as agent tools.

## Cloud sign-in

The sign-in viewer binds **127.0.0.1**, on an ephemeral port by default. A URL containing `127.0.0.1` refers to the Nakama host, so a remote user needs a tunnel or HTTPS proxy. Do not publish this port directly over HTTP.

For a single cloud instance, choose a fixed port and a dedicated HTTPS hostname:

```sh
NAKAMA_MEET_VIEWER_PORT=4311
NAKAMA_MEET_VIEWER_ORIGIN=https://meet-login.example.com
```

Proxy that hostname to `127.0.0.1:4311`, preserving the original Host header and WebSocket upgrades. The viewer uses `/` and `/ws` and must have its own origin, not a URL subpath. Keep query strings out of proxy access logs: the URL contains a temporary browser-control token. Restrict access through your existing authenticated proxy or private network. With Docker, put the proxy in the same container network namespace (for example, a sidecar using `network_mode: service:nakama`) so it can reach the loopback listener; publishing container port 4311 does not expose a loopback-bound service.

A fixed viewer port supports one org signing in at a time. Other orgs' profiles remain separate; a simultaneous login fails rather than attaching to another org's browser. Meeting transcription can continue in other orgs while an admin signs in. Without a proxy, use an SSH tunnel to the port shown in the sign-in URL and open that URL locally.

## Design

```text
Admin → temporary BetterWright viewer → Google login/MFA → org browser profile
Agent/UI → org SQLite queue → BetterWright Meet browser
         → dedicated PulseAudio sink → FFmpeg PCM → transcription adapter
         → OpenAI transcription WebSocket → stored transcript segments
```

The Nakama worker owns browser operations, so login and meeting capture cannot compete for the same profile. A private loopback control endpoint lets admin actions request login operations. Its bearer token stays in a private worker file. Public worker status and meeting tools never include the viewer URL or control token. BetterWright's credential vault is disabled; Google sessions persist only in the browser profile. Preserve the org plugin data volume across restarts and protect backups as credentials.

The browser runs with background parking disabled so Meet keeps processing audio. A virtual display avoids Playwright's headless audio mute. BetterWright still enforces its network proxy policy; test Meet connectivity on your deployment, including environments that restrict WebRTC/TCP fallback.

The worker supports one meeting per organization, up to 120 minutes (the default). Transcription sessions renew every 55 minutes while the browser stays in the meeting. It leaves when stopped, timed out, or removed. An empty room can remain open until the duration expires. Controls expect English Meet UI. Restarts fail interrupted meetings instead of silently rejoining; partial transcripts remain available.

Members see their own meetings; admins can manage org meetings. Agent tools additionally stay within the invoking profile. Transcripts can be downloaded as text. Segment times are receipt times, not word-level timestamps or speaker identification.

`src/transcription.ts` defines the provider boundary: `connect`, `push` (24 kHz mono PCM16), `finish`, and `close`, with final-segment/error callbacks. Add adapters to its registry and extend config validation, UI and manifest. Browser capture and storage stay unchanged. OpenAI uses a transcription-only Realtime WebSocket with server voice activity detection; completed turns are persisted in audio order.

## Development

```sh
bun install
bun run --cwd packages/plugins/google-meet build
bun test packages/plugins/google-meet/src
```

The generated `workers/meet.js` includes plugin code and loads the separately installed BetterWright runtime. Tests cover lifecycle and access boundaries with a fake browser; they do not prove Google login, Meet admission, Linux audio capture, or paid transcription. Verify those in a real authorized meeting on the deployment before relying on its records.
