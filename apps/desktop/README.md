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

External links open in the system browser. Remote content has no Node access or exposed native APIs. An isolated preload keeps the native title bar in sync with Nakama's Light, Dark, or System theme. Microphone, camera, and notification permissions remain disabled in this preview. Optional tools that need external programs, such as Python or a coding CLI, still require those programs to be installed.

## Verify

```sh
bun run --cwd apps/desktop test
bun run --cwd apps/desktop build:runtime
bun run --cwd apps/desktop test:runtime
```

The runtime test uses temporary data and verifies setup, saved login after a restart, web serving, and shutdown after the parent disconnects. `NAKAMA_DESKTOP_TEST_RUNTIME` can point it at the `Contents/Resources/runtime` directory of a packaged app.

## Automatic updates

Packaged apps check at startup and every six hours, downloading updates in the background. Choose **Restart now** to stop the local server and workers before installation, or **Later** to keep working. Ordinary quitting does not install an update. Local data is preserved; running tasks are interrupted by a restart.

macOS requires a signed app for automatic updates. Install the first signed release manually if you currently use an unsigned preview. Development runs do not check for updates.

## Publish a release

In GitHub, open **Settings → Environments → code-signing** and add these environment secrets. The release job uses this environment:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | Base64-encoded Developer ID Application certificate exported as a `.p12`, including its private key |
| `MAC_CSC_KEY_PASSWORD` | Password for the `.p12` |
| `APPLE_ID` | Apple developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple developer team ID |

Use the same signing identity for subsequent releases. The workflow requires signing and successful notarization before publishing.

1. Bump `apps/desktop/package.json` to a stable version, run `bun install`, and commit the changes.
2. Push the commit and a matching tag, for example `git tag desktop-v0.2.0` followed by `git push origin desktop-v0.2.0`.
3. The **Desktop Release** workflow builds on macOS ARM64, tests the bundled server, signs and notarizes the app, and publishes the DMG and ZIP in that version's GitHub release.

After all installers are published, the workflow promotes `latest-mac.yml` in the separate `desktop-updates` release. That metadata points to the immutable versioned downloads, so regular server releases cannot change the desktop update feed. Retries reuse published checksums, and older releases cannot move the channel backward. Do not manually replace published installers.
