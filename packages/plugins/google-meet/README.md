# Google Meet transcription

Join a Google Meet as a silent participant and save a live transcript using OpenAI `gpt-transcribe`. The agent's chat provider is independent. Meeting audio is sent to OpenAI; raw audio is not retained by this plugin.

## Setup

1. Run the Nakama server on Linux with Chromium, FFmpeg, PulseAudio and `pactl` installed. On Debian/Ubuntu:
   ```sh
   sudo apt-get install chromium ffmpeg pulseaudio pulseaudio-utils fonts-liberation
   ```
   For Docker, build this repository with `--build-arg INSTALL_MEET_DEPS=true`. The default image omits these optional dependencies. Chromium runs as Nakama's non-root user with its sandbox enabled; the host must permit Chromium sandbox/user namespaces. Do not disable the sandbox to work around container restrictions.
2. In **Plugins**, install and enable **Google Meet**. Start its worker in **Workers**.
3. On a desktop with Chrome/Chromium and Bun, run the built login helper:
   ```sh
   bun packages/plugins/google-meet/workers/meet.js auth /absolute/path/google-login.json
   ```
   Sign into the bot's Google account in the opened browser and press Enter in the terminal. `NAKAMA_MEET_CHROME` optionally selects the browser executable. Google may reject automated browser sign-in; this helper cannot bypass Google account policies.
4. On the plugin page, open **Settings**, enter a separately billed OpenAI API key, and import the login JSON. Login JSON grants access to the Google session: keep it private and delete the exported copy after importing. Re-import when Google expires the session.
5. Paste a Meet URL and choose the maximum duration, or ask an agent with the plugin tools assigned to join it. Notify participants before transcribing. The host may need to admit the bot.

The worker supports one meeting per organization, up to 55 minutes per meeting (within the realtime session lifetime). It leaves when stopped, the duration expires, or Meet removes the participant. An empty room can remain open until the duration expires. Browser controls currently expect English Meet UI.

Transcripts are available on the plugin page, as downloadable text, and through agent tools. Members see meetings they initiated; admins can manage org meetings. Agent tool calls additionally stay within the invoking profile. Failed meetings retain their partial transcript and error state. A worker restart fails interrupted meetings instead of silently rejoining them.

## Design

`Meeting tools → org-scoped SQLite queue → worker → Chromium speaker output → dedicated PulseAudio sink → FFmpeg PCM → transcription provider → transcript segments`

The host manages the worker with its existing plugin lifecycle. Each meeting uses a distinct audio sink. Browser cookies, credentials, and the meeting database live under the host-provided org plugin data directory. Credentials are stored in private files and never returned by actions.

`src/transcription.ts` defines the provider boundary: `connect`, `push` (24 kHz mono PCM16), `finish`, and `close`, with final-segment/error callbacks. To add another provider, implement that contract, register the adapter, and extend configuration validation plus the settings UI/manifest. Browser capture, meeting lifecycle, and storage remain unchanged. Provider adapters are responsible for bounded buffering, final flush, and stable segment IDs in audio order.

OpenAI uses a transcription-only Realtime WebSocket with `gpt-transcribe` and server voice activity detection. Final turns can arrive out of order; the adapter persists them in committed audio order. Connection and capture failures stop the meeting and mark it partial; there is no silent reconnect that could lose or duplicate speech. Segment times are receipt times, not word-level audio timestamps or speaker identification.

## Development

```sh
bun install
bun run --cwd packages/plugins/google-meet build
bun test packages/plugins/google-meet/src
```

Browser and paid API checks are separate from automated tests. Run a real authorized meeting to verify Google login, admission, audible capture, transcription, and shutdown on your deployment before relying on it for meeting records.
