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

## Package (Win / macOS / Linux)

```bash
npm run electron:make
```

Outputs depend on the host OS (electron-builder):

| Platform | Artifacts |
|----------|-----------|
| Windows  | NSIS installer |
| macOS    | DMG |
| Linux    | AppImage, deb |

For a directory unpack without installers: `npm run electron:pack`.

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
| `npm run electron:make` | Build installers for the current OS |
