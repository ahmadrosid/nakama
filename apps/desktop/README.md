# Nakama Desktop

A thin Electron window that loads the existing Nakama web app. It uses the same UI and server behavior; there is no separate desktop frontend, API client, or backend.

## Run

Start Nakama normally, then:

```sh
bun run dev:desktop
```

The default address is `http://localhost:4310/chat`. To connect elsewhere:

```sh
NAKAMA_DESKTOP_URL=https://nakama.example/chat bun run dev:desktop
```

Use HTTPS for remote servers. Sign in through the existing web form. Electron keeps its own browser session under `~/Library/Application Support/Nakama Desktop Electron`; it does not import the old GPUIX login or your browser's session. Web UI updates appear immediately when the server is updated.

Links to other sites open in the system browser. Remote content has no Node.js integration, preload bridge, or local filesystem API. Files selected in the web UI use its normal upload flow.

Microphone, camera, and notification permissions are disabled in this preview.

## Verify and package

```sh
bun run --cwd apps/desktop test
bun run --cwd apps/desktop package
```

The smoke test uses a hidden window and an isolated local HTTP fixture. Packaging writes the ARM64 app, DMG, and ZIP to `apps/desktop/dist/electron/`. End users need no separately installed Bun, Node, or Rust. The existing server must remain available.

The preview targets macOS 26 ARM64. Configure Developer ID signing and notarization credentials before public distribution. An unsigned local package is not a public release. Updates replace the application manually.
