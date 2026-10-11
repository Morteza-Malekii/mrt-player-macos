# MRT-Player for macOS

A local IPTV player for Apple Silicon Macs, built with Electron, React, and TypeScript. Connect your own Xtream-compatible account to browse live TV, movies, and series in a desktop interface.

![Version](https://img.shields.io/badge/version-0.2.1-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-black)
![Stack](https://img.shields.io/badge/stack-Electron%20%2B%20React%20%2B%20TypeScript-3178c6)

**Bring your own account and content.** MRT-Player does not include channels, playlists, subscriptions, or an IPTV service. Use an account and content you are authorized to access.

The application interface is currently in **Turkish**. This repository contains the macOS application; the LG webOS application is maintained separately.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Build a macOS application](#build-a-macos-application)
- [Using the player](#using-the-player)
- [Privacy and account storage](#privacy-and-account-storage)
- [Architecture](#architecture)
- [Development and verification](#development-and-verification)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

| Area | Capabilities |
| --- | --- |
| Live TV | Category browsing, channel search, short EPG, HLS playback, automatic retry after transient interruptions |
| Movies and series | Metadata and detail screens, seasons and episodes, seeking, pause, and playback resume |
| Personal library | Favorites, recent viewing history, custom category and item order, and local preferences |
| List management | Visible, PIN-locked, or hidden categories across live TV, movies, and series |
| Audio and subtitles | Select available audio tracks, remember the preferred language, and load local `.srt` or `.vtt` subtitles |
| Artwork | Optional provider logos and posters, with fallback tiles when images are unavailable |
| Playback diagnostics | Resolution, buffered duration, dropped frames, startup timing, interruptions, and media transfer statistics |
| Desktop controls | Keyboard navigation, fullscreen, volume, mute, and a resizable desktop window |

Playback uses conservative buffering and bounded recovery attempts. The media gateway handles upstream connections and adapts parallel movie transfers to the account's reported connection limit. Catalog browsing loads a category first, rather than immediately downloading every item.

## Requirements

- **macOS on Apple Silicon (`arm64`)** for the supported application package.
- **Node.js 22 and npm 10**, the versions used for local development and validation.
- An Xtream-compatible server address, username, and password.
- Network access to your provider and its media servers.

Intel Mac, Windows, and Linux packages are not configured in the current packaging script. Stream playback depends on the provider, network conditions, and codecs available in Electron's Chromium runtime.

## Quick start

```sh
git clone https://github.com/Morteza-Malekii/mrt-player-macos.git
cd mrt-player-macos
npm ci
npm start
```

`npm start` builds the renderer and Electron processes, then launches the app.

On the login screen:

1. Enter your server address, such as `https://provider.example:443`.
2. Enter the username and password issued by your provider.
3. Choose whether to save the account on this Mac.
4. Sign in and select a category or item.

Enter credentials **inside the application**. An `.env` file is not required. Avoid putting account details in source files, shell commands, tests, screenshots, or GitHub issues. Connecting over plain HTTP requires explicit confirmation in the login screen.

## Build a macOS application

```sh
npm run package
open 'release/MRT-Player-darwin-arm64/MRT-Player.app'
```

The packaging command runs type checking, unit tests, and the build before creating:

```text
release/MRT-Player-darwin-arm64/MRT-Player.app
```

The `.app` is **ad hoc signed** for local use. It is not notarized with an Apple Developer certificate. If macOS blocks the first launch, use Finder's Control-click → **Open** flow when available. A changed ad hoc signature can also cause Keychain to request access again after an update; re-enter the account in the application if needed.

Build output and installed dependencies are excluded from Git. Clone and build from source; this repository does not automatically publish installers or GitHub Releases.

The application icon is tracked at `assets/MRT-Player.icns`. Regenerating it with `python3 scripts/icons.py` is optional and requires Python with Pillow.

## Using the player

### Browse and play

The sidebar contains **Canlı TV** (Live TV), **Filmler** (Movies), **Diziler** (Series), **Favoriler** (Favorites), **Son izlenenler** (Recent), and **Ayarlar** (Settings).

Choose a category, search within its contents, and select a tile. Movies open through their detail screen; series provide season and episode selection. Live channels can show the provider's short electronic program guide.

For a search across the complete catalog, select **Tüm içerikler** (All content). Category browsing is preferable for very large libraries because it avoids loading everything at once.

### Manage lists and favorites

Open **Ayarlar → Listeleri yönet** (Settings → Manage lists) to reorder categories or change their visibility:

- **Visible:** the category and its content are accessible.
- **Locked:** the category remains listed, but its content requires a PIN.
- **Hidden:** the category and its content are excluded from browsing, search, favorites, and recent items, including after unlocking other lists.

The first category in your custom order becomes the initial category for that content type. Use **Sırala** (Arrange) in a category or Favorites to move items to the beginning, forward, or backward. **Sırayı sıfırla** (Reset order) restores provider order. Changes stay on this Mac and do not change the provider's catalog.

One 4–8 digit PIN unlocks the locked lists for the current session. Relock them from the sidebar or close the app. If a PIN exists, making a locked or hidden category visible also requires it. Five incorrect attempts trigger a 30-second wait. If the PIN is forgotten, removing the account from the device is the reset path.

### Audio and subtitles

For a movie or episode, open **Ses ve altyazı** (Audio and subtitles) in the player's lower-right corner:

- Choose an available audio track. The selected language is remembered for subsequent movies and episodes that contain a matching track.
- Load a local `.srt` or `.vtt` file. Supported text encodings include UTF-8, UTF-16 with a BOM, Turkish Windows-1254, and Persian Windows-1256; legacy encoding detection is heuristic.
- Select **Kapalı** (Off) to hide the loaded subtitles.

External subtitles apply only to the current playback. Embedded subtitles are not exposed by the current Chromium playback path. AC-3, E-AC-3, and DTS audio tracks are not available in the audio menu. The audio/subtitle menu is not shown during live TV.

### Keyboard controls

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Move between controls |
| `Enter` | Activate the focused control |
| `Space` | Play or pause |
| `F` | Toggle fullscreen |
| `M` | Toggle mute |
| `Esc` | Close the current menu/dialog or return to the previous view |
| `←` / `→` in fullscreen | Seek 10 seconds backward/forward in movies and episodes |

Player shortcuts are suspended while typing in form fields. Double-clicking the video also toggles fullscreen.

## Privacy and account storage

MRT-Player runs locally and does not require a hosted MRT-Player backend.

- **Optional saved credentials:** Electron `safeStorage` encrypts the account using macOS Keychain-backed protection.
- **Local library:** favorites, recent items, preferences, and list configuration are stored in the application's local data directory. These library records are not encrypted as a whole.
- **Renderer isolation:** account-bearing media URLs remain in the main process; playback uses opaque `kiyi://media/...` addresses. Optional artwork uses `kiyi://image/...` addresses.
- **Artwork off by default:** enabling posters/logos contacts the image URLs supplied by the provider. These may point to third-party CDNs or image services, which receive your image requests and IP address.
- **Network requests:** provider API calls, media requests and redirects, and optional provider-supplied artwork. The app has no telemetry, analytics, remote error reporting, or application log files.
- **Desktop boundary:** the renderer is sandboxed, uses context isolation, has no Node integration, and calls a restricted preload bridge. A Content Security Policy restricts resource loading.

A list PIN is a household privacy feature. It does not protect the library from someone who can read or modify the local files. Only a salted PBKDF2-SHA256 PIN hash is stored.

The current bundle identifier is `com.kiyi.player.mac`. The older `Kıyı Player` data directory is reused when present so an upgrade can retain local account and library data.

## Architecture

```text
React renderer
    │ restricted preload / Electron IPC
    ▼
Electron main process
    ├── Xtream session and API client
    ├── Keychain-backed credential vault
    ├── Local library storage
    ├── Media gateway → provider streams
    └── Image gateway → optional provider artwork
```

| Path | Responsibility |
| --- | --- |
| `src/core/` | Xtream models and API helpers, EPG, library normalization, ordering, PINs, audio/subtitle helpers |
| `src/runtime/` | Session actions, HTTP transport, local storage |
| `src/platform/mac/` | Electron main/preload processes, media and image gateways, playback adapter |
| `src/ui/` | React screens, player controls, list management, styles |
| `scripts/` | Build, packaging, local fixtures, integration and Electron checks |
| `tests/` | Unit tests |
| `assets/` | Application icon |
| `docs/` | Architecture notes, implementation history, and validation records |

The runtime dependencies are React, React DOM, hls.js, and mpegts.js. TypeScript and esbuild handle compilation; Electron Packager produces the macOS bundle.

## Development and verification

Run the standard local verification:

```sh
npm run check
npm run test:integration
```

`check` runs TypeScript checking, unit tests, and the build. The integration suite uses a loopback Xtream fixture. These commands do not require a real IPTV account.

Additional checks exercise the real Electron application and specific playback behavior:

| Command | Coverage |
| --- | --- |
| `npm run test:e2e` | Login, navigation, EPG, movies, series, and playback |
| `npm run test:4k` | Synthetic local 3840×2160 HLS playback and diagnostics |
| `npm run test:switch` | Channel-switch timing and upstream connection reuse |
| `npm run test:recover` | Interrupted and bandwidth-limited live streams |
| `npm run test:lanes` / `npm run test:solo` | Parallel media transfers and single-connection accounts |
| `npm run test:cushion` / `npm run test:cushion:safety` | Buffer recovery and bounded waiting |
| `npm run test:rate` | Media transfer behavior under throttling |
| `npm run test:keychain` | Saved account and Keychain behavior |
| `npm run test:lock` | PIN, visibility, and relocking flows |
| `npm run test:order` | Custom ordering and persistence |
| `npm run test:tracks` | Audio selection and external subtitles |
| `npm run test:posters` | Optional images, fallback tiles, and privacy defaults |
| `npm run test:packaged` / `npm run test:4k:packaged` | Existing packaged `.app` verification |

Build the application with `npm run package` before running packaged checks. Electron checks open application windows and use disposable local profiles. Test media is synthesized locally with ffmpeg; fixtures use randomly generated account identifiers. Test media, results, and fixtures are excluded from the packaged app.

Synthetic 4K tests describe local fixture behavior. They do not establish real-provider compatibility or long-term streaming reliability. See [validation records](docs/VALIDATION.md) for measured results and the limits of each check.

### Relationship to the webOS version

The macOS and webOS projects keep separately versioned copies of `src/core`, `src/runtime`, and `src/ui`. Each repository builds independently. Their code currently differs; newer macOS playback and UI features have not all been ported to TV.

`npm run shared:check` expects a sibling `../webOs` checkout by default and currently reports differences. To compare against another location:

```sh
npm run shared:check -- /path/to/webOs
```

`shared:sync` copies this repository's shared folders into the other checkout. Review platform compatibility and existing differences before using it.

Additional project documents are currently in Turkish:

- [Architecture and implementation plan](docs/PLAN.md)
- [Validation results and boundaries](docs/VALIDATION.md)
- [Frontend guide](docs/FRONTEND-REHBERI.md)

## Known limitations

- The packaged target is macOS Apple Silicon, with ad hoc signing and no notarization.
- The UI is currently Turkish; selecting an audio language does not change the interface language.
- Playback depends on the stream container, codec, provider behavior, and account connection limits. There is no bundled transcoder.
- Embedded subtitles, subtitle timing offsets, and automatically loading provider subtitle URLs are not supported.
- HLS movie audio-track behavior and real-provider audio switching have not been established by the local fixtures.
- Ordering uses buttons rather than drag-and-drop. All content and Recent are not manually reorderable; stored custom orders are bounded.
- Some older series-episode favorite/history entries lack a category ID, so category hiding/locking cannot reliably filter those legacy records.
- The separate webOS project does not have feature parity with this macOS version.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Sign-in fails | Server address, account credentials, account status, TLS certificate validity, and explicit HTTP confirmation if needed |
| A channel does not start | Provider availability, account connection limit, and the stream's codec/container |
| Frequent buffering | Open **Akış bilgisi** (Stream information) to inspect buffer, dropped frames, and interruptions; check network and provider throughput |
| An audio language is missing | The stream may omit it or encode it as unsupported AC-3, E-AC-3, or DTS |
| Subtitles do not appear | Load an external `.srt`/`.vtt`; embedded subtitles are unsupported |
| The saved account cannot be opened after an update | Check Keychain access or re-enter the account through the login screen |
| A category or favorite is missing | Check list visibility and PIN state in Settings → Manage lists |
| `shared:check` fails | Confirm the sibling checkout exists; platform code currently differs, as documented above |

When reporting a problem, include the app version, macOS version, relevant playback format/codec, and reproduction steps. Remove account credentials and stream URLs from any attachments.

## Contributing

Open an issue to describe a bug or propose a change. For a code contribution, keep platform-specific work under `src/platform/mac/`, run `npm run check`, and run the relevant integration or Electron checks for changed behavior. Update documentation when user-visible behavior changes.

Use the local fixtures for reproduction. Do not commit provider credentials, real account data, private playlists, generated build output, or local test profiles.

## License

A project license has not been added to this repository. Third-party dependencies retain their respective licenses.
