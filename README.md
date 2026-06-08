# CLI Deck

CLI Deck is a Windows desktop workspace for running Codex, OpenCode, Claude Code and other CLI tools in one tiled window.

It uses Electron, `@lydell/node-pty` and xterm.js so each session runs in a real pseudo terminal.

## Run locally

```powershell
npm.cmd install
npm.cmd start
```

In restricted Windows environments where Electron cannot write to the default `AppData` location, run with local app data:

```powershell
$env:CLI_DECK_PORTABLE_DATA='1'; npm.cmd start
```

## Build an exe

```powershell
npm.cmd run build:dir
```

The runnable app is written to `dist/win-unpacked/CLI Deck.exe`.

To build a single portable exe or installer:

```powershell
npm.cmd run build
```

That target uses NSIS. If your network cannot reach GitHub, use `build:dir` or pre-populate the electron-builder NSIS cache.

## Workflow

Start sessions from inside CLI Deck. Each session appears as a polished terminal panel and the workspace automatically tiles all running sessions so several command windows can stay visible on one screen.

Default launch presets:

- `codex`
- `opencode`
- `claude`

Use **New Session** for a custom command or working directory.

Session controls include restart, duplicate, open working directory, rename, copy command, close active session, and close stopped sessions.

Use **Settings** to edit launch presets, the default working directory, raw log recording, max log size, and raw log retention.

## Memory layer

CLI Deck records sessions it launches and groups memory by working directory.

Stored locally under Electron `userData`:

- Raw terminal logs.
- Session metadata and heuristic summaries.
- Project memory with recent sessions, common commands and known failure snippets.
- A sidebar Memory panel with `Current` and `History` views, so closed sessions remain browsable.
- History search and filters for project path, command text, tool, status, and failure category.
- Project detail actions for starting a new session in that project, opening the working directory, opening raw logs, exporting memory as JSON or Markdown, deleting project memory, and cleaning expired raw logs.

Raw logs are capped at 20 MB per session by default. Expired raw `.log` files are cleaned on app startup after 30 days, while failed session logs are kept for 60 days. Session `.json` summaries and project memory are retained. These values can be changed in Settings.

The memory layer is local-only and uses controlled main-process IPC for exports and cleanup. It does not call AI APIs, run hook scripts, scan source files, modify project files, or attach already-running external terminal windows.

Detailed design: `docs/CLI_DECK_MEMORY_PRD.md`.
