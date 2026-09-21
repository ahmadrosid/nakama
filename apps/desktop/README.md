# Nakama Desktop

The existing Nakama web app with a bundled local server. Opening the app starts the server automatically; quitting stops the server and its background workers. No separate Bun, Node, Docker, or Nakama server installation is needed.

## Develop and build

From an Apple Silicon Mac or Windows x64 machine with this Git checkout and Bun installed:

```sh
bun install
bun run dev:desktop
```

Create the macOS app, DMG, and ZIP:

```sh
bun run --cwd apps/desktop package
```

The build includes Bun, the production server and worker dependencies, and the built web UI. Outputs are in `apps/desktop/dist/electron/`. The app targets macOS 15 (Sequoia) or later on Apple Silicon and is unsigned until Developer ID signing and notarization credentials are configured. Release builds and runtime tests run on macOS 15. Windows targets Windows 10 build 19041 or later, x64, through the Microsoft Store.

## Local data

Complete the normal setup wizard on first launch. Configure your model provider as on the web; cloud models still require internet access and provider credentials.

Desktop stores its browser session in `~/Library/Application Support/Nakama Desktop Electron` on macOS, or Electron's app-data directory under `Nakama Desktop Electron` on Windows. Store installs may virtualize the Windows app-data location. On macOS, server data is stored in `~/.nakama-desktop` so agent tools do not scan through the protected `~/Library` tree; existing server data is migrated there on first launch. Existing web-server data is not imported. Updates preserve these directories. Server diagnostics are in `server.log`.

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

Microsoft Store installs receive updates through the Store; they do not use the GitHub update feed.

Other packaged apps check at startup and every six hours, downloading updates in the background. Choose **Restart now** to stop the local server and workers before installation, or **Later** to keep working. Ordinary quitting does not install an update. Local data is preserved; running tasks are interrupted by a restart.

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

## Windows: Microsoft Store signing

The Windows build produces an **unsigned MSIX for Partner Center upload**. Microsoft signs the package after Store certification; no purchased signing certificate is needed. This does not provide a signed installer for direct GitHub downloads. See [Microsoft's signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

1. Register in [Partner Center](https://partner.microsoft.com/dashboard), reserve the app name, and open **Product identity**.
2. Add these GitHub environment secrets under **Settings → Environments → code-signing → Environment secrets**, copying the values exactly. The Windows job uses this environment and its approval rules.

   | Secret | Partner Center value |
   | --- | --- |
   | `WINDOWS_STORE_IDENTITY_NAME` | Package/Identity/Name |
   | `WINDOWS_STORE_PUBLISHER` | Package/Identity/Publisher, including `CN=` |
   | `WINDOWS_STORE_PUBLISHER_DISPLAY_NAME` | Package/Properties/PublisherDisplayName |
   | `WINDOWS_STORE_DISPLAY_NAME` | Reserved app display name |

3. Run **Actions → Desktop Release → Run workflow** on the desired branch. Manual runs build Windows only; version tags continue to publish macOS. Each Store update requires a higher stable desktop package version; the generated fourth version component stays zero.
4. Download the `nakama-windows-store` workflow artifact and upload its `.msix` to the app submission. Complete the listing, privacy policy, screenshots, age rating, and certification questions. Explain `runFullTrust`: Nakama runs an Electron desktop UI and a bundled local Bun server with background workers.
5. Test the installed package through a Store package flight before making it public: first-run setup, chat, restart, worker shutdown, and an update that preserves saved data. The workflow tests the unpacked runtime; it cannot prove installed MSIX behavior or Store acceptance.

To build locally, set the same four environment variables in PowerShell 7 on Windows x64, then run:

```powershell
bun install --frozen-lockfile
bun run --cwd apps/desktop package:store
```

The pinned electron-builder uses its `appx` target to invoke Windows SDK MakeAppx with `.msix` output. Both use the same package manifest format. Required Store tile assets are generated from Nakama's existing icon. The unsigned output is for Store submission; ordinary sideloading requires a separately trusted signature.
