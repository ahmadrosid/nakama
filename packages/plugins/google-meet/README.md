# Google Meet transcription

Transcripts save automatically as text files in the organization's plugin data folder under `transcripts/`. Open **Saved transcripts** to view them; downloading a copy to your computer is optional. Existing meeting transcripts are exported automatically when the updated plugin runs.

Join Google Meet as a silent participant and save a live transcript using OpenAI `gpt-transcribe`. BetterWright handles the browser and persistent Google sign-in. The chat provider is independent; transcription needs a separately billed OpenAI API key. Raw audio is not retained.

## Setup

1. Run Nakama on Linux with Bun 1.4+, Chromium, Xvfb, FFmpeg, PulseAudio and `pactl`:
   ```sh
   sudo apt-get install chromium xvfb ffmpeg pulseaudio pulseaudio-utils fonts-liberation
   mkdir -p /opt/nakama-meet
   cd /opt/nakama-meet
   bun add --exact --production --ignore-scripts betterwright@2.8.1
   ```
   Set `NAKAMA_MEET_CHROME=/usr/bin/chromium` on the Nakama server. Alternatively install BetterWright's managed browser and set `BETTERWRIGHT_CHROMIUM_PATH` to its executable. `NAKAMA_MEET_BETTERWRIGHT_PATH` can point to another installed SDK's absolute `dist/src/index.js` path. The SDK must retain its dependencies and sibling files; it cannot be bundled into `meet.js` alone.

   For Docker, build with `--build-arg INSTALL_MEET_DEPS=true`; this installs the complete runtime. The default image omits it. Run as a non-root user with Chromium sandbox support. Each browser gets its own virtual display and each meeting gets its own PulseAudio sink.
2. Install and enable **Google Meet** in **Plugins**, then start its worker in **Workers**.
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

The worker supports one meeting per organization, up to 55 minutes. It leaves when stopped, timed out, or removed. An empty room can remain open until the duration expires. Controls expect English Meet UI. Restarts fail interrupted meetings instead of silently rejoining; partial transcripts remain available.

Members see their own meetings; admins can manage org meetings. Agent tools additionally stay within the invoking profile. Transcripts can be downloaded as text. Segment times are receipt times, not word-level timestamps or speaker identification.

`src/transcription.ts` defines the provider boundary: `connect`, `push` (24 kHz mono PCM16), `finish`, and `close`, with final-segment/error callbacks. Add adapters to its registry and extend config validation, UI and manifest. Browser capture and storage stay unchanged. OpenAI uses a transcription-only Realtime WebSocket with server voice activity detection; completed turns are persisted in audio order.

## Development

```sh
bun install
bun run --cwd packages/plugins/google-meet build
bun test packages/plugins/google-meet/src
```

The generated `workers/meet.js` includes plugin code and loads the separately installed BetterWright runtime. Tests cover lifecycle and access boundaries with a fake browser; they do not prove Google login, Meet admission, Linux audio capture, or paid transcription. Verify those in a real authorized meeting on the deployment before relying on its records.
