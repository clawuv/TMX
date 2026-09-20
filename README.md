# TMX

[![GitHub license](https://img.shields.io/github/license/clawuv/TMX?color=fa6470)](https://github.com/clawuv/TMX/blob/main/LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/clawuv/TMX?color=8b5cf6)](https://github.com/clawuv/TMX/releases)
[![Required Node.js >= 20.19.0 || >= 22.12.0](https://img.shields.io/static/v1?label=node&message=%3E=20.19.0%20||%20%3E=22.12.0&logo=node.js&color=3f893e)](https://nodejs.org/about/releases)

English | [简体中文](README.zh-CN.md)

TMX is a modern desktop terminal client for SSH workflows, built on Electron + React. It bundles a real persistent terminal (node-pty / ssh2 / xterm.js), a host manager, SFTP, snippets, an AI copilot and a built-in MCP server into a single cross-platform app (macOS / Windows / Linux).

## Screenshots

| Terminal | SFTP |
|---|---|
| ![Terminal](docs/screenshots/terminal.png) | ![SFTP](docs/screenshots/sftp.png) |
| **Themes & preferences** | **Command palette** |
| ![Themes](docs/screenshots/settings-themes.png) | ![Command palette](docs/screenshots/command-palette.png) |

## Features

- **SSH & local terminals** — real pty sessions powered by node-pty (local shell) and ssh2 (remote hosts). Sessions stay alive per tab (scrollback, vim and running jobs survive tab switches), with split panes and a PuTTY-style workflow: copy on select, right-click to paste.
- **Host manager** — organize connections in groups with credentials (password, Ed25519 / private key, passphrase), sorted and searchable.
- **SFTP** — browse the remote file tree, upload/download with progress and cancellation, plus a local filesystem browser for quick uploads.
- **Snippets** — save frequently used commands and run them in any session.
- **AI Copilot** — a built-in assistant drawer for generating and explaining commands.
- **API batch testing** — fire a set of HTTP requests and inspect results, useful for backend smoke tests.
- **System monitor** — live top-process view for the local machine.
- **Built-in MCP server** — TMX exposes a local stdio [Model Context Protocol](https://modelcontextprotocol.io) server so external AI clients (Claude, Cursor, …) can drive your terminals: `list_hosts`, `list_sessions`, `exec_command`, `send_session_input`, `read_session_output`, `run_snippet`, `sftp_list`, `sftp_read_file`.
- **ZMODEM** — sz/rz transfers straight inside the terminal.
- **Theming & preferences** — 5 curated themes, terminal font/line-height/cursor customization, configurable scrollback, all stored in local SQLite (hosts, bookmarks, snippets, preferences).
- **Desktop feel** — native menus and context menus, window state restore, quit confirmation when live SSH sessions would be dropped, i18n (简体中文 / English), auto-update via electron-updater.

## Tech Stack

Electron 42 · React 19 · Vite 8 · TypeScript · TailwindCSS v4 · xterm.js 6 · node-pty · ssh2 · better-sqlite3 · electron-builder

## Quick Start

Requirements: Node.js >= 20.19.0 (or >= 22.12.0) and pnpm.

```sh
# clone the project
git clone https://github.com/clawuv/TMX.git

# enter the project directory
cd TMX

# install dependencies (native addons are rebuilt automatically)
pnpm install

# start development
pnpm dev
```

> Native addons (node-pty, better-sqlite3, ssh2) target Electron's ABI. If they act up after an Electron upgrade, run `pnpm rebuild:natives`.

## Available Scripts

- `pnpm dev`: start the Vite dev server and launch the app.
- `pnpm build`: build the renderer and package the app with electron-builder (output in `release/${version}`).
- `pnpm preview`: preview the production web build locally.
- `pnpm test`: run Vitest unit tests.
- `pnpm test:e2e`: build the test-mode bundle and run Playwright tests.
- `pnpm typecheck`: run the TypeScript type checker.
- `pnpm rebuild:natives`: force-rebuild native addons against Electron's ABI.

## Build & Release

Pushing a `v*` tag (e.g. `v1.0.0`) triggers the [Build and Release](.github/workflows/build.yml) workflow, which packages macOS (dmg/zip), Windows and Linux artifacts via electron-builder and attaches them to a GitHub Release.

## Project Structure

```tree
├── build/            Packaging assets (app icons)
├── dist-electron/    Compiled Electron output (generated)
├── electron/         Main-process, preload and MCP server source
│   ├── main/         Window, terminal/SFTP/SQLite/MCP IPC, menus, updater
│   ├── mcp/          Standalone stdio MCP server (dist-electron/mcp/server.mjs)
│   └── preload/      Preload bridge exposed to the renderer
├── public/           Static assets
├── src/
│   ├── tmx/          Application source (components, i18n, data, utils)
│   ├── components/   Auto-update modal component
│   └── type/         Shared renderer types
└── test/             Unit and end-to-end tests
    └── e2e/
```

Files under `electron/` are compiled into `dist-electron/`.

## Security Note

The `renderer: {}` preset in `vite.config.ts` is only a Vite adapter that polyfills Electron, Node.js APIs and native modules for the renderer process. It is not the same as enabling Node integration. If you want direct Node.js access in the renderer, enable `nodeIntegration` in the `BrowserWindow` webPreferences in the main process and review the security impact carefully.

## License

[MIT](LICENSE)
