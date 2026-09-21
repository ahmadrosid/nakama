# Google Meet transcription

The plugin creates a short-lived capture session. The Nakama Chrome extension captures the active Meet tab and microphone, sends 24 kHz mono PCM16 audio to the org worker, and OpenAI `gpt-4o-transcribe-diarize` produces speaker-labelled turns while recording continues. The worker uploads 15-second audio chunks; results appear after chunking and provider processing, rather than word by word. Stop flushes the final chunk and finishes any queued transcription.

## Setup

1. Install the plugin and start the Google Meet worker in **Workers**.
2. Open **Google Meet → Settings** and save an OpenAI API key. Transcription is billed separately from ChatGPT.
3. Install the unpacked extension from the `extension/` directory in Chrome at `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
4. Refresh the Nakama Google Meet page after installing or reloading the extension. Open the extension on that page and choose **Connect this Nakama tab**. It uses your signed-in Nakama session; no credentials or capture URLs need to be pasted.
5. Join a Google Meet call, open the extension in that tab, and choose **Start transcription**. Keep the connected Nakama page open. If microphone setup opens, allow access and retry from the Meet tab.

The extension popup shows the latest 200 turns, labelled **Speaker 1**, **Speaker 2**, and so on. Closing the popup does not stop recording; reopening reloads the transcript. Choose **Open full transcript** to view the complete meeting in Nakama. Copy, download and agent transcript results retain speaker labels and timestamps are available in the transcript action.

These are voice labels, not verified Meet participant names. Up to four voice references help keep labels consistent across chunks; short speech, overlap and additional speakers can cause separate labels for the same person. No Meet captions are used.

The worker temporarily stores private PCM audio files in the plugin data directory. It deletes each processed chunk, keeps short voice references in memory until processing ends, and removes remaining audio on failure or restart. If processing falls five minutes behind, recording ends with a partial-failure status rather than dropping audio silently. Existing transcripts and file imports remain readable.

Update the plugin/worker and reload the unpacked extension together, then refresh and reconnect the Nakama page.

Tell participants before transcribing. Leave the meeting from Nakama or stop capture from the extension. Restarts fail interrupted meetings instead of silently rejoining; partial transcripts remain available.

## Upload recordings or transcripts

Choose **Upload file** in **Meeting history**. Import Markdown (`.md`, `.markdown`, up to 1 MiB), or audio (`.mp3`, `.mp4`, `.mpeg`, `.mpga`, `.m4a`, `.wav`, `.webm`, up to 7 MiB). Audio uploads use the provider and model configured in Nakama's **Settings → Transcription**; the plugin does not receive provider credentials. Keep the page open until the import finishes.

Imported files appear in history with their filename until the running Google Meet worker generates a title. Title generation and live Chrome capture still use the OpenAI key in the plugin's settings.

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
  → org worker WebSocket → bounded WAV uploads to OpenAI diarization
  → org SQLite segments → Nakama UI, extension popup and agent tools
```

The extension owns browser access; the Nakama worker owns authorization, audio forwarding, OpenAI, and persistence. The architecture follows [meet-transcriber](https://github.com/hugoblanc/meet-transcriber), adapted to process chunks during capture and keep credentials on the Nakama worker.

## Development

```sh
bun install
bun run --cwd packages/plugins/google-meet build
bun test packages/plugins/google-meet/src
```

Automated tests cover session authorization, stream lifecycle, transcript persistence, and access boundaries. A real Chrome/Meet smoke test is still required before production use.
