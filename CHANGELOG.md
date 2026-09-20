# Changelog

All notable changes to TMX are documented here.

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
