# PKC

**Portable Knowledge Cartridge** — desktop tool for macOS, Linux, and Windows.

Powered by Acharya Annadata. Built with Capacitor + [@capacitor-community/electron](https://github.com/capacitor-community/electron) and [`@annadata/pack-it-pkc`](ref-code/pack-it-pkc).

## Features

- Custom title bar: **PKC - Powered by Acharya Annadata**, plus Settings, Info, and Close
- Toggleable panels: **Upload**, **Blocks**, **Preview**, **Chat** (Model & export) — any combination can be open at once
- Document convert / PDF block edit / PKC pack via `pack-it-pkc`

## Prerequisites

- Node.js 18+
- npm 9+

## Setup

```bash
# Build the local pack-it-pkc library, then install the app
npm install --prefix ref-code/pack-it-pkc
npm run build --prefix ref-code/pack-it-pkc
npm install
npm install --prefix electron
```

If Electron fails to launch with a missing-binary error, from `electron/` run:

```bash
node node_modules/electron/install.js
# or: npm run postinstall
```

The first Electron platform folder is created with:

```bash
npm run build:web
npx cap add @capacitor-community/electron
```

(Already done in this repo if `electron/` exists.)

## Develop

```bash
# Web UI only (browser)
npm run dev

# Build web + sync into Electron, then launch Electron
npm run electron:start
```

## Package / release (macOS + Windows)

Artifacts land in `electron/release/`.

### Prerequisites (llama sidecar)

Desktop inference needs staged binaries in `llama-cpp-pro/extraResources/sidecar/`:

```bash
# macOS universal (arm64 + x64) — run in ../llama-cpp-pro
npm run build:sidecar:universal && npm run stage:desktop
npm run verify:desktop:bundle -- --arch=universal

# Windows x64 — must run on Windows
npm run build:sidecar:win && npm run stage:desktop
npm run verify:desktop:bundle -- --platform=win32
```

### Local release builds

```bash
# macOS → PKC-*-mac-arm64.dmg and PKC-*-mac-x64.dmg (+ .zip). Unsigned unless Apple certs are configured.
npm run release:mac

# Windows → PKC-*-win-x64-setup.exe (run on Windows, after win32 sidecar is staged)
npm run release:win
```

Current-OS only (no platform flag): `npm run electron:make`.  
Directory unpack without installers: `npm run electron:pack`.

### CI release (recommended for .exe)

Push a version tag to build both platforms and attach artifacts to a GitHub Release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Or run **Actions → Release desktop → Run workflow**. Private sibling repos need a `GH_PAT` secret with `repo` access to `arusatech/llama-cpp-pro` and `arusatech/pack-it-pkc`.

| Platform | Artifacts |
|----------|-----------|
| macOS    | DMG + zip (arm64 and x64) |
| Windows  | NSIS `*-setup.exe` |
| Linux    | AppImage, deb (`electron:make` on Linux) |

Unsigned mac builds: Gatekeeper will warn until notarized. Windows SmartScreen may warn until code-signed.

## Layout

| Path | Role |
|------|------|
| `src/` | Web UI (title bar, tab toggles, convert panes) |
| `electron/` | Capacitor Electron shell (frameless window, close IPC) |
| `ref-code/pack-it-pkc` | Local plugin dependency (gitignored reference) |
| `ref-code/electron` | Capacitor Electron reference sources |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite web app |
| `npm run build:web` | Production web build → `dist/` |
| `npm run build` | Web build + `cap sync` Electron |
| `npm run electron:start` | Build and run Electron |
| `npm run release:mac` | Verify sidecar + build macOS DMG/zip (arm64 + x64) |
| `npm run release:win` | Verify sidecar + build Windows NSIS installer |
| `npm run electron:make` | Build installers for the current OS |
