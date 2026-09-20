# Changelog

All notable changes to TMX are documented here.

## 1.0.1

- Keep the new application identifier `io.github.clawuv.tmx` and the `clawuv/TMX` update feed.
- Report asynchronous update staging/install failures after the download completes.
- Handle update IPC/download rejections and show guidance for macOS App Translocation.
- Allow an explicit update installation to bypass the SSH session close confirmation.
- Check for updates shortly after startup.
- Remove demo AI history and the outdated settings version badge; refine command palette and SFTP styling.

Migration: v1.0.0 used `io.github.he2dou.tmx`. Install v1.0.1 manually to migrate to the new identifier; in-app installation cannot migrate between these identifiers. macOS packages are not Developer ID signed or notarized.

## 1.0.0

Initial release.

- SSH & local terminal sessions (node-pty / ssh2 / xterm.js) with persistent per-tab sessions, split panes, ZMODEM transfers
- Host manager with groups and credential support (password, Ed25519 / private key, passphrase)
- SFTP file browser with transfers and local filesystem browsing
- Snippets library, AI Copilot drawer, API batch testing, system process monitor
- Command palette (⌘K)
- Built-in stdio MCP server (`list_hosts`, `list_sessions`, `exec_command`, `send_session_input`, `read_session_output`, `run_snippet`, `sftp_list`, `sftp_read_file`)
- 5 built-in themes, terminal appearance preferences (font, line height, cursor, scrollback, copy-on-select, right-click paste)
- SQLite local storage for hosts / bookmarks / snippets / preferences
- 简体中文 / English i18n, auto-update via electron-updater
- Cross-platform packaging (macOS dmg/zip, Windows, Linux) via electron-builder and GitHub Actions
