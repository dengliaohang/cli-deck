# CLI Deck

[中文](README.md) | [English](README_EN.md)

CLI Deck is an Electron desktop workspace for running and managing multiple AI CLI sessions at the same time. It places Codex, Claude Code, OpenCode, or any custom CLI command in one tiled window, and keeps local project memory grouped by working directory.

## Features

- Starts real PTY terminal sessions inside the app instead of capturing external terminal windows.
- Automatically tiles multiple sessions, which is useful when running several Codex / Claude / OpenCode tasks in parallel.
- Supports custom command, arguments, and working directory.
- Lets you decide whether each new session is recorded in Memory, which is useful for temporary or sensitive sessions.
- Orchestrator: lets you choose or create one AI CLI as the swarm brain; the brain can emit `CLI_DECK_COMMAND_ACTUAL` blocks to dispatch, cancel, retry, request status, or message a worker, and worker results are reported back to the brain for the next scheduling step.
- Session titles automatically include the tail of the current path, for example `Codex — workspace/tools`; long paths keep only the last two segments.
- Session actions: restart, duplicate, rename, copy command, open cwd, and close stopped.
- Local memory layer:
  - raw terminal log
  - session summary JSON
  - project memory JSON
  - history search and filters
  - project detail view, open logs, export JSON/Markdown, delete project memory, and clean expired raw logs
- Settings panel for presets, default working directory, raw log toggle, log size, and retention days.

## Supported Platforms

The main development and verification platform is currently Windows. The session launcher also supports macOS / Linux through the system shell:

- Windows: `powershell.exe`
- macOS: `$SHELL`, defaulting to `/bin/zsh`
- Linux: `$SHELL`, defaulting to `/bin/sh`

On macOS, source-based running is recommended first. A `build:mac` directory build script is provided, but macOS packaging must be run on a macOS machine.

## Run Locally

### Windows

```powershell
npm.cmd install
npm.cmd start
```

If Electron cannot write to the default `AppData` location, store runtime data inside the project:

```powershell
$env:CLI_DECK_PORTABLE_DATA='1'; npm.cmd start
```

### macOS

Install Node.js 20+ first, then run:

```bash
npm install
npm start
```

If Codex, Claude Code, or OpenCode is not available in PATH, verify that each command works in a normal terminal first:

```bash
codex --version
claude --version
opencode --version
```

On macOS, CLI Deck starts sessions through `$SHELL -lc "<command>"`, so it reads your shell login environment. Put common CLI paths in `~/.zshrc`, `~/.zprofile`, or the config file for the shell you actually use.

### Linux

```bash
npm install
npm start
```

Linux also uses `$SHELL -lc "<command>"` to start CLI sessions. Verify that the target CLI works in a normal terminal first.

## Build

### Windows Directory Build

```powershell
npm.cmd run build:dir
```

Output:

```text
dist/win-unpacked/CLI Deck.exe
```

### Windows Portable / Installer

```powershell
npm.cmd run build
```

This target uses NSIS. If your network cannot access GitHub, use `build:dir` or pre-populate the electron-builder NSIS cache.

### macOS Directory Build

Run on macOS:

```bash
npm run build:mac
```

The output is written under the related `dist/mac*` directory. The current configuration is a directory build for local verification; formal distribution still needs icon configuration, code signing, and notarization.

## Memory Storage

CLI Deck writes session memory under Electron `userData`, not inside your source repository:

```text
<userData>/memory/
  projects/
    <cwd-hash>.json
  sessions/
    <YYYY-MM-DD>/
      <session-id>.log
      <session-id>.json
  exports/
    <project-name>-<hash>.md
    <project-name>-<hash>.json
```

Default policy:

- Raw log limit is 20 MB per session.
- Normal raw logs are kept for 30 days.
- Failed session raw logs are kept for 60 days.
- Session JSON summaries and project memory are retained.
- Raw log toggle, size, and retention days can be changed in Settings.

## Orchestrator Swarm Scheduling

For coding, build, test, or review objectives, Dispatch first creates a worker task directly in CLI Deck and assigns it by capability; worker results are then reported back to the Brain for follow-up scheduling. Plain chat objectives are sent to the Brain directly.

Example dispatch command:

```text
CLI_DECK_COMMAND_ACTUAL_START
action: dispatch
capability: implement
target: opencode
task: Implement the sidebar task-list scrolling fix
CLI_DECK_COMMAND_ACTUAL_END
```

Supported Brain commands:

- `dispatch`: requires `task`; optional `capability` and `target`
- `status`: asks CLI Deck to report sessions and tasks back to the brain
- `cancel`: requires `task_id`
- `retry`: requires `task_id`
- `message`: requires `target` and `message`

When a worker finishes with a `CLI_DECK_RESULT_ACTUAL` block, CLI Deck updates task state and sends the result plus swarm status back to the Brain.

## Non-Goals

The current version is intentionally local, deterministic, and controlled:

- It does not call cloud AI APIs to generate summaries.
- It does not run custom hook scripts.
- It does not scan the whole source repository to learn code automatically.
- It does not modify project source files.
- It does not attach already-running external terminal windows.

## Development Commands

```bash
npm test
npm start
```

Windows build:

```powershell
npm.cmd run build:dir
```

macOS directory build:

```bash
npm run build:mac
```

## Project Docs

- [Feature PRD and architecture design](docs/CLI_DECK_PRD.md)
- [Memory Layer PRD](docs/CLI_DECK_MEMORY_PRD.md)

## Repository Contents

Should be committed:

- `src/`
- `docs/`
- `scripts/`
- `README.md`
- `README_EN.md`
- `LICENSE`
- `package.json`
- `package-lock.json`
- `.gitignore`

Should not be committed:

- `node_modules/`
- `dist/`
- `.electron-cache/`
- `.electron-builder-cache/`
- `.localappdata/`
- `.npm-cache/`
- `.home/`
- `.env*`
- logs and temporary files

## License

Apache-2.0
