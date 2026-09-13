# Nakama Desktop

The existing Nakama web app with a bundled local server. Opening the app starts the server automatically; quitting stops the server and its background workers. No separate Bun, Node, Docker, or Nakama server installation is needed.

## Develop and build

From an Apple Silicon Mac with this Git checkout and Bun installed:

```sh
bun install
bun run dev:desktop
```

Create the macOS app, DMG, and ZIP:

```sh
bun run --cwd apps/desktop package
```

The build includes Bun, the production server and worker dependencies, and the built web UI. Outputs are in `apps/desktop/dist/electron/`. The preview targets macOS 26 ARM64 and is unsigned until Developer ID signing and notarization credentials are configured.

## Local data

Complete the normal setup wizard on first launch. Configure your model provider as on the web; cloud models still require internet access and provider credentials.

Desktop stores its browser session in `~/Library/Application Support/Nakama Desktop Electron` and its server data under `server/` within that directory. Existing web-server data is not imported. Updates preserve this directory. Server diagnostics are in `server/server.log`.

The server binds only to `127.0.0.1`, on an available port. Desktop waits for it to start before loading the UI. Closing the app stops its server; automations and channel workers run while the app is open.

To use an existing server instead:

```sh
NAKAMA_DESKTOP_URL=https://nakama.example/chat bun run dev:desktop
```

External links open in the system browser. Remote content has no Node access or preload bridge. Microphone, camera, and notification permissions remain disabled in this preview. Optional tools that need external programs, such as Python or a coding CLI, still require those programs to be installed.

## Verify

```sh
bun run --cwd apps/desktop test
bun run --cwd apps/desktop build:runtime
bun run --cwd apps/desktop test:runtime
```

The runtime test uses temporary data and verifies setup, saved login after a restart, web serving, and shutdown after the parent disconnects. `NAKAMA_DESKTOP_TEST_RUNTIME` can point it at the `Contents/Resources/runtime` directory of a packaged app.
