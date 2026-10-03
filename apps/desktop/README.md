# Nakama Desktop

The existing Nakama web app with a bundled local server. Opening the app starts the server automatically; quitting stops the server and its background workers. No separate Bun, Node, Docker, or Nakama server installation is needed.

## Windows installation

Windows installer builds target Windows 10 build 19041+ and Windows 11 x64. In [desktop releases](https://github.com/ahmadrosid/nakama/releases?q=desktop-v), look for `Nakama-<version>-x64-Setup.exe`. Run it to install for your Windows account, then open Nakama and complete setup. Updates and uninstalling preserve your saved data. A signed installer may still show a Windows SmartScreen warning.

**Do not install the unsigned `.msix` from older releases.** It is a Partner Center upload, not an installer you can double-click. New builds keep that package in the `nakama-windows-store` workflow artifact for Store submission only.

Releases through 0.1.8 do not include the EXE. Until the first signed Windows installer is published and verified, use the [web demo](https://demo.getnakama.cloud/) or [run Nakama with Docker](../../README.md#docker). There is no public Microsoft Store link yet.

## Develop and build

From an Apple Silicon Mac or Windows x64 machine with this Git checkout and Bun installed:

```sh
bun install
bun run desktop
```

Create the macOS app, DMG, and ZIP:

```sh
bun run --cwd apps/desktop package
```

On Windows x64, create the full NSIS installer:

```powershell
bun run --cwd apps/desktop package:windows
```

The build includes Bun, the production server and worker dependencies, and the built web UI. Outputs are in `apps/desktop/dist/electron/`. Local builds are unsigned without signing credentials. macOS targets macOS 15 (Sequoia) or later on Apple Silicon; Windows targets Windows 10 build 19041+ and Windows 11 x64. CI tests the unpacked runtime, not an installed GUI.

## Local data

Complete the normal setup wizard on first launch. Configure your model provider as on the web; cloud models still require internet access and provider credentials.

Desktop stores its browser session in `~/Library/Application Support/Nakama Desktop Electron` on macOS, or Electron's app-data directory under `Nakama Desktop Electron` on Windows. Store installs may virtualize the Windows app-data location. On macOS, server data is stored in `~/.nakama-desktop` so agent tools do not scan through the protected `~/Library` tree; existing server data is migrated there on first launch. Existing web-server data is not imported. Updates preserve these directories. Server diagnostics are in `server.log`.

The server binds only to `127.0.0.1`, on an available port. Desktop waits for it to start before loading the UI. Closing the app stops its server; automations and channel workers run while the app is open.

To use an existing server instead:

```sh
NAKAMA_DESKTOP_URL=https://nakama.example/chat bun run desktop
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
3. The **Desktop Release** workflow builds macOS ARM64 and Windows x64 in parallel, tests the bundled server, signs the installers, notarizes macOS, and publishes the DMG, ZIP, and EXE together. Either installer build failing prevents publication.

After all installers are published, the workflow promotes `latest-mac.yml` and Windows `latest.yml` independently in the separate `desktop-updates` release. Metadata points to immutable versioned downloads. Retries use published bytes and cannot move either channel backward. If one promotion fails, rerun the publisher to finish it. Do not replace published installers or add an EXE to an incomplete old release; use a new version.

## Windows: EXE signing and first release

The NSIS job uses electron-builder v26 certificate signing. Configure the **code-signing** environment before pushing the next desktop tag:

| Setting | Value |
| --- | --- |
| Secret `WINDOWS_CSC_LINK` | Base64-encoded Authenticode PFX/P12 certificate with its private key |
| Secret `WINDOWS_CSC_KEY_PASSWORD` | Certificate password |
| Variable `WINDOWS_PUBLISHER_NAME` | Exact certificate publisher common name |

Store identity settings do not sign an EXE. If your signing key is hardware-backed or uses Azure Artifact Signing, integrate that provider's v26 signing configuration before enabling releases; do not export a non-exportable key or disable signature verification. Missing credentials prevent release publication, including macOS publication in the combined release.

1. Select **Actions → Desktop Release → Run workflow → Windows artifact: installer**, using the candidate branch and leaving the tag blank. Manual runs only upload an artifact; they never publish releases or update feeds.
2. Download `nakama-windows-installer`. Once, on disposable standard-user Windows 10 19041+ and Windows 11 accounts, install the EXE and check setup, restart, shutdown, uninstall/reinstall, and saved data. Check the installed uninstaller's Authenticode signature. Record the commit, artifact checksum, OS build, and results.
3. Before the first Windows release, test an actual upgrade between two privately signed, ordered versions with the same identity and a private generic update feed. Check data preservation and worker shutdown; a corrupt download must not replace the app. Build these on an approved signing machine or use separate manual installer runs on test refs, adapting their feed validation to the private URL. Never change the production feed or export CI signing secrets for testing.
4. Tag the exact candidate commit after validation. The tag workflow rebuilds and verifies it; signing timestamps can change the binary checksum. Repeat manual checks only when installer, signing, updater, or shutdown behavior changes.

Use disposable accounts for installed-app checks: the app stores server data under `%USERPROFILE%/.nakama-desktop` and does not honor `NAKAMA_CONFIG_DIR` as a test override. Routine CI does not install or launch the full app. Before announcing Windows availability, verify the public EXE and both update-feed download URLs.

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

3. Run **Actions → Desktop Release → Run workflow** on the desired branch with **Windows artifact: store** (the default). A supplied tag must name an existing desktop release; leave it blank to build the selected branch. Each Store update requires a higher stable desktop package version; the generated fourth version component stays zero.
4. Download the `nakama-windows-store` workflow artifact and upload its `.msix` to the app submission. Complete the listing, privacy policy, screenshots, age rating, and certification questions. Explain `runFullTrust`: Nakama runs an Electron desktop UI and a bundled local Bun server with background workers.
5. Test the installed package through a Store package flight before making it public: first-run setup, chat, restart, worker shutdown, and an update that preserves saved data. The workflow tests the unpacked runtime; it cannot prove installed MSIX behavior or Store acceptance.

To build locally, set the same four environment variables in PowerShell 7 on Windows x64, then run:

```powershell
bun install --frozen-lockfile
bun run --cwd apps/desktop package:store
```

The pinned electron-builder uses its `appx` target to invoke Windows SDK MakeAppx with `.msix` output. Both use the same package manifest format. Required Store tile assets are generated from Nakama's existing icon. The unsigned output is for Store submission; ordinary sideloading requires a separately trusted signature.
