# Google Meet transcription

The plugin creates a short-lived capture session. The Nakama Chrome extension captures the active Meet tab and microphone, sends 24 kHz mono PCM16 audio to the org worker, and OpenAI `gpt-transcribe` writes live transcript segments. Raw audio is not retained.

## Setup

1. Install the plugin and start the Google Meet worker in **Workers**.
2. Open **Google Meet → Settings** and save an OpenAI API key. Transcription is billed separately from ChatGPT.
3. Install the unpacked extension from the `extension/` directory in Chrome at `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
4. Open the Meet tab and the Nakama Google Meet page. Enter the Meet URL in Nakama and choose **Start capture session**. Nakama automatically tells the extension to start capture.
5. If the extension is not connected to the Nakama page, paste the fallback capture URL into the extension popup.

Tell participants before transcribing. Leave the meeting from Nakama or stop capture from the extension. Restarts fail interrupted meetings instead of silently rejoining; partial transcripts remain available.

## Remote workers

The worker listens on loopback by default. For a remote Chrome browser, expose the WebSocket through an authenticated HTTPS proxy and set:

```sh
NAKAMA_MEET_CAPTURE_HOST=0.0.0.0
NAKAMA_MEET_CAPTURE_ORIGIN=wss://meet-capture.example.com/capture
```

Preserve WebSocket upgrades and do not log query strings: the capture URL contains a temporary token. The token is single-use and scoped to one organization, meeting, and expiry time.

## Design

```text
Chrome Meet tab + microphone → extension offscreen audio mixer
  → org worker WebSocket → OpenAI transcription WebSocket
  → org SQLite segments → Nakama UI and agent tools
```

The extension owns browser access; the Nakama worker owns authorization, audio forwarding, OpenAI, and persistence. The architecture follows [meet-transcriber](https://github.com/hugoblanc/meet-transcriber), adapted to use the existing Nakama OpenAI transcription provider and meeting store.

## Development

```sh
bun install
bun run --cwd packages/plugins/google-meet build
bun test packages/plugins/google-meet/src
```

Automated tests cover session authorization, stream lifecycle, transcript persistence, and access boundaries. A real Chrome/Meet smoke test is still required before production use.
