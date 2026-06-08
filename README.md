# CLI Deck

[中文](README.md) | [English](README_EN.md)

CLI Deck 是一个用于同时运行和管理多个 AI CLI 会话的 Electron 桌面工作台。它把 Codex、Claude Code、OpenCode 或任意自定义 CLI 放在同一个平铺窗口里，并为每个工作目录保存本地项目记忆。

## 功能特性

- 在应用内启动真实 PTY 终端会话，不依赖抓取外部终端窗口。
- 多 session 自动平铺展示，适合同时跑多个 Codex / Claude / OpenCode 任务。
- 支持自定义 command、arguments、working directory。
- 创建 session 时可选择是否记录到 Memory，适合临时或敏感会话。
- Orchestrator 调度大脑：选择或创建一个 AI CLI 作为蜂群主脑；Brain 可通过 `CLI_DECK_COMMAND_ACTUAL` 协议派发、取消、重试、查询状态或给指定 worker 发消息，worker 结果会自动回传给 Brain 继续调度。
- session 标题会自动追加当前路径尾部信息，例如 `Codex — workspace/tools`，长路径只取最后两段。
- 支持 restart、duplicate、rename、copy command、open cwd、close stopped。
- 本地 memory 层：
  - raw terminal log
  - session summary JSON
  - project memory JSON
  - 历史搜索和筛选
  - 项目详情、打开日志、导出 JSON/Markdown、删除项目记忆、清理过期 raw logs
- Settings 面板可配置 presets、默认工作目录、raw log 开关、日志大小和保留天数。

## 支持平台

当前主要开发和验证环境是 Windows。代码已经支持 macOS / Linux 使用系统 shell 启动 CLI：

- Windows: 使用 `powershell.exe`
- macOS: 使用 `$SHELL`，默认 `/bin/zsh`
- Linux: 使用 `$SHELL`，默认 `/bin/sh`

macOS 上建议先按源码方式运行。打包脚本已提供 `build:mac` 的目录构建目标，但 macOS 打包需要在 macOS 机器上执行。

## 本地运行

### Windows

```powershell
npm.cmd install
npm.cmd start
```

如果 Electron 无法写入默认 `AppData` 目录，可以把运行数据放到项目内：

```powershell
$env:CLI_DECK_PORTABLE_DATA='1'; npm.cmd start
```

### macOS

先安装 Node.js 20+，然后执行：

```bash
npm install
npm start
```

如果 Codex、Claude Code 或 OpenCode 不在默认 PATH 中，请先确认在普通终端里能直接运行：

```bash
codex --version
claude --version
opencode --version
```

CLI Deck 在 macOS 创建 session 时会通过 `$SHELL -lc "<command>"` 启动命令，因此会读取你的 shell 登录环境。常见 CLI 路径可放在 `~/.zshrc`、`~/.zprofile` 或你实际使用 shell 的配置文件中。

### Linux

```bash
npm install
npm start
```

Linux 使用 `$SHELL -lc "<command>"` 启动 CLI。请先确认目标 CLI 在普通终端中可直接运行。

## 构建

### Windows 目录版

```powershell
npm.cmd run build:dir
```

输出目录：

```text
dist/win-unpacked/CLI Deck.exe
```

### Windows portable / installer

```powershell
npm.cmd run build
```

这个目标会使用 NSIS。如果网络无法访问 GitHub，请使用 `build:dir`，或提前准备 electron-builder 的 NSIS 缓存。

### macOS 目录版

需要在 macOS 上执行：

```bash
npm run build:mac
```

输出在 `dist/mac*` 相关目录中。当前配置是目录构建，适合本地验证；正式分发还需要补充签名、公证和图标配置。

## Memory 存储位置

CLI Deck 把会话记忆写在 Electron `userData` 下，不写入你的源码仓库：

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

默认策略：

- 单 session raw log 上限 20 MB。
- 普通 raw log 保留 30 天。
- failed session raw log 保留 60 天。
- session JSON summary 和 project memory 会保留。
- 可在 Settings 中调整 raw log 开关、大小和保留天数。

## Orchestrator 蜂群调度

Orchestrator 现在以 CLI Deck 内部 Task Board 作为事实源：Dispatch 会创建 task，Dispatcher 根据能力选择 worker，Worker Adapter 负责把任务送进具体 CLI。当前默认 adapter 是 PTY prompt，兼容 Codex / Claude / OpenCode 这类交互式 TUI；后续可以接入 Codex app-server 或非交互命令 adapter。

任务状态包括 `ready`、`running`、`blocked`、`done`、`cancelled`。每次派发会创建 run，记录 attempts、assignee、run id 和事件流。worker 退出但任务没有结果时，CLI Deck 会把运行中的 task 标记为 `blocked`，用户可以 Retry。

Dispatch 遇到开发、构建、测试、复核类目标会先由 CLI Deck 直接创建 worker task 并按能力派发；Brain 会收到后续 worker 结果并继续调度。普通聊天目标才直接发给 Brain。

示例：让 CLI Deck 派发实现任务：

```text
CLI_DECK_COMMAND_ACTUAL_START
action: dispatch
capability: implement
target: opencode
task: 实现左侧任务列表滚动修复
CLI_DECK_COMMAND_ACTUAL_END
```

支持的 Brain command：

- `dispatch`: 需要 `task`，可选 `capability`、`target`
- `status`: 查询 sessions 和 tasks，CLI Deck 会回传给 Brain
- `cancel`: 需要 `task_id`
- `retry`: 需要 `task_id`
- `message`: 需要 `target` 和 `message`

worker 完成后输出 `CLI_DECK_RESULT_ACTUAL`，CLI Deck 会更新任务状态，并把结果和当前 swarm 状态发回 Brain。

协议块仍然是当前 PTY adapter 的兼容汇报方式，但不是长期唯一控制面。长期设计是：Task Board / Dispatcher 管状态，Worker Adapter 负责不同 CLI 工具的可靠输入输出。

## 不做什么

当前版本刻意保持本地、确定性和可控：

- 不调用云端 AI API 生成摘要。
- 不执行用户自定义 hook 脚本。
- 不扫描整个源码仓库来自动学习代码。
- 不修改项目源码文件。
- 不 attach 已经运行的外部终端窗口。

## 开发命令

```bash
npm test
npm start
```

Windows 构建：

```powershell
npm.cmd run build:dir
```

macOS 目录构建：

```bash
npm run build:mac
```

## 项目文档

- [功能设计 PRD 与架构设计](docs/CLI_DECK_PRD.md)
- [Memory Layer PRD](docs/CLI_DECK_MEMORY_PRD.md)

## 仓库内容说明

应该提交到 GitHub：

- `src/`
- `docs/`
- `scripts/`
- `README.md`
- `README_EN.md`
- `LICENSE`
- `package.json`
- `package-lock.json`
- `.gitignore`

不应该提交：

- `node_modules/`
- `dist/`
- `.electron-cache/`
- `.electron-builder-cache/`
- `.localappdata/`
- `.npm-cache/`
- `.home/`
- `.env*`
- 日志和临时文件

## 许可证

Apache-2.0
