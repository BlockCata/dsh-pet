# Big Fat Fish Desktop Pet

[繁體中文 README](README.md)

A standalone Windows Electron desktop pet with transparent animation, multi-pet management, interactive controls, AI chat, and local diary memory.

This project is derived from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet). The original DSH plugin remains in `dsh-pet/`; the standalone desktop application added by this project is in `desktop-app/` and does not require DSH.

## Features

- Transparent, frameless desktop-pet windows with system-tray controls
- Create, duplicate, remove, and configure multiple pets independently
- Automatic roaming, dragging, click responses, and context-menu actions
- Pointer passthrough on transparent pixels, so only visible character pixels receive interaction
- Configurable size, position, monitor, always-on-top state, and roaming range
- Chat support for Gemini, OpenAI, DeepSeek, and OpenAI-compatible services
- Separate conversation and diary memory for each pet, with configurable retention
- PNG, JPEG, and WebP image attachments; only providers with image input receive them
- API keys encrypted with Electron `safeStorage`
- Uses existing upstream blue-haired maid WebM animations; no media assets were generated or modified

## Use the portable build

Download the Windows x64 portable EXE from GitHub Releases, extract it, and run it directly.

The first launch needs a moment to unpack the runtime. The pet then appears at the bottom-right of the primary display. Node.js is not required, and the app does not open a browser.

> Before updating, exit the running version from the system tray.

## Run from source

Requirements:

- Windows
- Node.js
- npm

```powershell
git clone https://github.com/BlockCata/dsh-pet.git
cd dsh-pet\desktop-app
npm.cmd install
npm.cmd test
npm.cmd start
```

## Development and packaging

```powershell
cd desktop-app

npm.cmd run prepare:assets  # Import existing upstream assets; does not generate media
npm.cmd test                # Run logic, IPC, settings, and asset-origin tests
npm.cmd run test:desktop    # Validate the settings UI in Electron
npm.cmd start               # Start the development build
npm.cmd run dist            # Build the Windows x64 portable EXE
```

## Data and privacy

AI API keys are encrypted and stored by the Electron main process. Pet, chat, and settings windows can request only limited IPC operations; they do not receive plaintext keys.

Conversations, diaries, and image attachments are stored in the local application-data directory. Deleting local data prevents the app from reading or sending it again, but cannot revoke data previously sent to an AI provider.

## Repository layout

```text
desktop-app/   Standalone Windows Electron desktop pet
dsh-pet/       Upstream DSH plugin source and asset configuration
docs/          Design, verification, and decision records
```

## Upstream source and asset terms

This project is derived from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet).

- Source code follows the upstream MIT License; retain the copyright and license notices.
- Animation, prompt, and source-video assets may be used in open-source projects but are **not licensed for commercial use**.
- `desktop-app/` includes 91 existing upstream WebM animations; no assets were generated or altered.
- See [desktop-app/ASSET-NOTICE.md](desktop-app/ASSET-NOTICE.md) for complete attribution and restrictions.

## License

The code is available under the [MIT License](LICENSE). Asset restrictions are governed by `desktop-app/ASSET-NOTICE.md` and the upstream project documentation.
