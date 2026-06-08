# CLI Deck Memory Layer PRD

## 1. Background

CLI Deck currently provides a tiled terminal workspace for Codex, Claude Code, OpenCode and custom CLI sessions. The next product step is to make the workspace remember useful context from those sessions, so repeated work across many CLI windows becomes easier to continue, review and reuse.

The first version must be deterministic and local-first. It should record session facts, preserve logs, produce lightweight summaries, and expose project memory in the UI. It must not silently execute commands, modify user files, or depend on external AI APIs.

## 2. Goals

- Persist each owned CLI session as a local record.
- Save enough terminal input/output context to review what happened.
- Create a project-level memory grouped by working directory.
- Show memory for the active session's project inside the app.
- Update memory automatically when a session exits.
- Keep terminal interactivity fast and reliable.

## 3. Non-Goals

- Attaching already-running external terminal windows.
- Calling Codex, Claude, OpenCode, or any cloud API to generate summaries.
- Automatically changing prompts, commands, files, or CLI configuration.
- Building a full hook editor UI in this version.
- Sharing memory across machines.

## 4. Users and Scenarios

### 4.1 Continue a Project

When the user opens a new session in a directory they used before, CLI Deck should show the recent project memory: previous commands, session summaries, common tools and known failures.

### 4.2 Review What Happened

After several tiled CLI sessions, the user should be able to see which sessions ran, what command launched them, whether they exited successfully, and where the raw log is stored.

### 4.3 Detect Repeat Work

If the same working directory is used repeatedly, CLI Deck should accumulate facts such as common commands and recent summaries. Later versions can convert these observations into suggestions.

## 5. Product Requirements

### 5.1 Session Recording

For every session created from CLI Deck:

- Assign a stable session id.
- Store command, args, title, working directory, start time, exit time, exit code and signal.
- Append terminal output to a raw log file.
- Append user input to the same raw log file with direction markers.
- Maintain a bounded text tail in memory for summary generation.
- Stop writing raw terminal output after the configured per-session log size limit is reached.

### 5.2 Session Summary

When a session exits, generate a local heuristic summary with:

- Final status: succeeded, failed, or stopped.
- Duration.
- Launch command.
- Working directory.
- Number of captured user input chunks.
- Recent meaningful output lines.
- Detected failure hints, if the recent output contains common error words.

The summary must be useful even without AI. It should be concise and stable.

### 5.3 Project Memory

Project memory is keyed by normalized working directory hash and stores:

- Working directory path.
- First seen and last seen timestamps.
- Session count.
- Tool usage counts.
- Recent sessions, newest first.
- Recent summaries, newest first.
- Frequent user-entered command lines.
- Known failure snippets.

Retention limits:

- Recent sessions: 20.
- Recent summaries: 20.
- Frequent commands: 20.
- Failure snippets: 20.
- Raw log size: 20 MB per session by default.
- Raw log retention: 30 days by default.
- Failed raw log retention: 60 days by default.

### 5.4 UI

Add a Memory panel to the sidebar:

- Show memory for the active session's working directory.
- If no active session exists, show historical projects and recent session summaries.
- Show session count, last seen time, common commands and recent summaries.
- Provide a visible raw log path for the latest summary.
- Provide `Current` and `History` views so memory remains browsable after terminal panes are closed.

The panel should be compact and scannable because the primary screen remains the tiled terminal workspace.

### 5.5 IPC/API

Expose safe read-only memory IPC:

- `memory:getProject(cwd)` returns project memory for a cwd.
- `memory:listProjects(limit)` returns recent project memories sorted by last seen time.
- `memory:getActiveBaseInfo` is not required in v1 because renderer already knows active cwd.
- `memory:updated` event notifies renderer after a session exits and memory is persisted.

No renderer API should directly write memory in v1.

## 6. Technical Design

### 6.1 Storage Location

Use Electron `app.getPath('userData')`:

```text
<userData>/memory/
  projects/
    <cwd-hash>.json
  sessions/
    <YYYY-MM-DD>/
      <session-id>.log
      <session-id>.json
```

This keeps logs outside the user's source repositories and avoids accidental commits.

### 6.2 Main Process Integration

Hook into existing PTY lifecycle:

- On `spawnSession`: create recorder metadata and log files.
- On `proc.onData`: append output, update bounded tail, forward output to renderer.
- On `terminal:input`: append input, update input counters, then write to PTY.
- On `proc.onExit`: finalize recorder, write session JSON, update project memory, emit `memory:updated`, emit `terminal:exit`.
- On app startup: clean expired raw `.log` files while retaining session `.json` summaries and project memory.

Terminal output forwarding must not wait for disk writes.

### 6.3 Summary Heuristics

Use lightweight local parsing:

- Strip ANSI sequences.
- Normalize blank lines.
- Keep the last 12 meaningful output lines.
- Mark potential failures using keywords such as `error`, `failed`, `exception`, `traceback`, `denied`, `not recognized`, `cannot find`, `timeout`.
- Extract user command candidates from input chunks ending in Enter.

### 6.4 Safety

- Do not record sessions that were not launched by CLI Deck.
- Do not execute any hook script in v1.
- Do not send logs to network services.
- Keep writes append-only during active sessions.
- Keep project memory and session summaries small; raw logs are capped and expire.
- On storage failure, keep the terminal working and emit console diagnostics only.

## 7. Future Hooks Direction

The internal lifecycle should map naturally to future hooks:

- `beforeStart`
- `afterStart`
- `onInput`
- `onOutput`
- `onExit`
- `onSummary`

In v1 these are internal function boundaries only. A user-configurable hook system can be added after the storage model is stable.

## 8. Acceptance Criteria

- Starting a session creates a log file and session metadata under userData.
- Typing into a terminal still works normally.
- Terminal output still streams in real time.
- Closing or exiting a session updates project memory.
- The sidebar Memory panel updates when active session changes.
- The Memory panel updates after session exit.
- Syntax check passes for main, preload and renderer files.
- `npm.cmd run build:dir` succeeds.
