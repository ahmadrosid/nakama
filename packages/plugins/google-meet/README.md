# Google Meet transcription

The plugin creates a short-lived capture session. The Nakama Chrome extension captures the active Meet tab and microphone, sends 24 kHz mono PCM16 audio to the org worker, and OpenAI `gpt-transcribe` writes live transcript segments. Raw audio is not retained.

## Setup

1. Install the plugin. Its worker starts automatically. A saved OpenAI provider key is reused; otherwise add a key in **Google Meet → Settings**. Transcription uses OpenAI API billing.
2. On the Google Meet page, choose **Download Chrome extension** and unzip it. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the unzipped folder. Refresh the Nakama page afterward. Reload an existing extension after updating its files.
3. Open **Google Meet** in Nakama. Open the extension popup and choose **Connect this Nakama tab**. Keep this Nakama tab open and signed in, with the organization you want to use selected.
4. Join a meeting in Chrome. Open the extension from that Meet tab and choose **Start transcription**. The extension uses the current meeting URL automatically; no URLs or tokens need copying.
5. Read live text and saved transcripts in Nakama. Choose **Stop transcription** in Nakama or the extension to finish. Sessions have a maximum duration of two hours.

Tell participants before transcribing. Closing the Meet tab stops capture. Browser restarts require reconnecting the extension; interrupted meetings retain partial transcripts.

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
