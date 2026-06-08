# CLI Deck 功能设计 PRD 与架构设计

## 1. 产品定位

CLI Deck 是一个桌面端 AI CLI 工作台，用于在一个窗口内同时启动、平铺、管理多个 CLI 会话，例如 Codex、Claude Code、OpenCode 或自定义命令。

产品目标不是替代终端，而是给多 AI CLI 并行工作提供更清晰的可视化工作区、会话控制和本地项目记忆。

## 2. 目标用户

- 经常同时运行多个 AI CLI 任务的开发者。
- 希望把不同项目目录的 CLI 会话历史保留下来的用户。
- 需要快速回看某个项目最近命令、失败原因和 raw log 的用户。

## 3. 核心场景

### 3.1 并行启动多个 AI CLI

用户可以从 preset 或 New Session 表单启动多个 CLI，会话自动平铺，便于同时观察输出。

### 3.2 按项目查看历史记忆

用户选择某个 session 后，Memory 面板展示当前 working directory 的项目记忆；没有活动 session 时展示 History。

### 3.3 临时敏感会话不入库

创建 session 时可以关闭 `Record this session in Memory`。关闭后该 session 仍可正常运行和交互，但不会写 raw log、不会生成 summary、不会更新 project memory。

### 3.4 从历史恢复工作

History 中可以搜索项目、命令、失败信息，进入项目详情后可以打开 cwd、打开 raw log、导出 memory，或从该目录重新启动会话。

## 4. 功能范围

### 4.1 Session 工作台

- New Session 表单字段：
  - Name
  - Command
  - Arguments
  - Working directory
  - Record this session in Memory
- Session 标题自动追加路径尾部：
  - 例：`Codex — workspace/tools`
  - 长路径只取最后两段目录
- 支持操作：
  - Restart
  - Duplicate
  - Rename
  - Copy command
  - Open CWD
  - Close
  - Close stopped
- Memory 关闭的 session 在列表和 tile header 中显示 `Memory off` / `MEMORY OFF` 标记。

### 4.2 Presets 与 Settings

- 默认 presets：
  - Codex
  - Claude Code
  - OpenCode
- Settings 支持：
  - 编辑 presets
  - 默认 working directory
  - raw logs 开关
  - max log MB
  - raw log retention days
  - failed raw log retention days

### 4.3 Memory

Memory 是本地规则摘要，不调用云端 AI API。

记录内容：

- raw terminal log
- session summary JSON
- project memory JSON

Project memory 聚合字段：

- cwd
- firstSeen / lastSeen
- sessionCount
- toolUsage
- frequentCommands
- knownFailures
- recentSessions
- recentSummaries

History 支持：

- query 搜索
- tool 筛选
- status 筛选
- failureCategory 筛选
- 项目详情
- 打开 raw log
- 导出 JSON / Markdown
- 删除 project memory
- 清理过期 raw logs

## 5. 非目标

- 不 attach 已经运行的外部终端窗口。
- 不调用云端 AI API 生成摘要。
- 不执行用户自定义 hook 脚本。
- 不扫描整个源码仓库自动学习代码。
- 不修改用户项目源码文件。
- 不把 project memory 变成完整日志仓库。

## 6. 架构设计

### 6.1 总体结构

```text
Renderer UI
  ├─ Session form / tiled terminals
  ├─ Memory current/history panel
  └─ Settings dialog

Preload bridge
  └─ window.cliDeck safe IPC API

Main process
  ├─ PTY session manager
  ├─ Memory recorder
  ├─ Project memory repository
  ├─ Settings store
  └─ File/path operations

Electron userData
  └─ memory/
      ├─ projects/
      ├─ sessions/
      └─ exports/
```

### 6.2 进程边界

Renderer 不直接访问 Node.js、文件系统或 `electron-store`。

所有写入都在 main process 内完成：

- 创建 PTY
- 关闭 PTY
- 写 raw log
- 写 session summary
- 更新 project memory
- 导出 memory
- 删除 memory
- 打开路径
- 保存 settings

Preload 只暴露白名单 API，避免 renderer 获得任意文件写权限。

### 6.3 Session 生命周期

```text
renderer startSession(config)
  -> ipc terminal:create(config)
  -> main spawnSession(config)
    -> normalize cwd
    -> build session title
    -> choose platform shell
    -> if memoryEnabled: create recorder
    -> pty.spawn(...)
    -> return session metadata

pty onData
  -> if recorder exists: record output
  -> send terminal:data to renderer

renderer terminal input
  -> ipc terminal:input
  -> if recorder exists: record input
  -> proc.write(data)

pty onExit
  -> if recorder exists:
       build summary
       write session JSON
       update project memory
       emit memory:updated
  -> emit terminal:exit
```

### 6.4 Memory 开关设计

`terminal:create(config)` 接收：

```json
{
  "command": "codex",
  "args": [],
  "cwd": "C:/project",
  "memoryEnabled": true
}
```

规则：

- `memoryEnabled !== false` 时默认开启。
- 关闭时 main process 不创建 recorder。
- recorder 为 `null` 时：
  - `recordOutput` 不执行
  - `recordInput` 不执行
  - `finalizeSessionRecorder` 返回 `null`
  - 不发送 `memory:updated`
  - 不创建 raw log 或 summary JSON
- UI 仍保留 terminal scrollback；关闭 memory 不影响终端交互。

### 6.5 跨平台启动层

Windows：

```text
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command <quoted command>
```

macOS：

```text
$SHELL -lc <quoted command>
fallback: /bin/zsh
```

Linux：

```text
$SHELL -lc <quoted command>
fallback: /bin/sh
```

命令和参数通过 shell quote 组合，避免空格和单引号破坏启动命令。

### 6.6 存储设计

所有 memory 数据写入 Electron `userData`：

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

项目 key：

- 使用 normalized cwd
- 小写后 SHA-256
- 取前 20 位 hex

Retention：

- raw log 默认 30 天
- failed raw log 默认 60 天
- 单 session raw log 默认 20 MB
- session JSON 和 project memory 默认保留

### 6.7 IPC 设计

Renderer -> Main：

- `app:getConfig`
- `app:saveConfig(config)`
- `app:selectDirectory`
- `app:openPath(path)`
- `memory:getProject(cwd)`
- `memory:getProjectByKey(projectKey)`
- `memory:listProjects(limit)`
- `memory:searchProjects(options)`
- `memory:exportProject({ projectKey, format })`
- `memory:deleteProject({ projectKey, deleteSessionFiles })`
- `memory:cleanupRawLogs`
- `terminal:create(config)`
- `terminal:input`
- `terminal:resize`
- `terminal:close`

Main -> Renderer：

- `terminal:data`
- `terminal:exit`
- `memory:updated`

## 7. UI 设计

### 7.1 主布局

- 左侧 sidebar：
  - New Session
  - Settings
  - Sessions
  - Presets
  - Memory
- 右侧 workspace：
  - toolbar
  - tiled terminal panes

### 7.2 New Session

Memory 开关放在 working directory 下面。默认开启，用户显式关闭后只影响当前创建的 session。

### 7.3 Memory 面板

Current：

- 当前 session 对应 cwd 的 project memory
- 显示 common commands、recent summaries、known failures

History：

- 搜索和筛选历史项目
- 点击项目进入详情
- 支持导出、打开日志、重新启动项目 session

## 8. 安全与隐私

- 默认本地存储，不联网。
- 不上传 raw log。
- 不在 renderer 中直接写文件。
- Memory 开关允许用户在敏感 session 中禁用持久化。
- raw log 有大小上限和过期清理。
- 删除 project memory 不默认删除 raw session files，避免误删排障材料。

## 9. 验收标准

- 创建 session 时默认开启 Memory。
- 关闭 Memory 创建 session 后：
  - session 能正常运行
  - UI 显示 Memory off
  - 不创建 raw log
  - 不创建 session summary JSON
  - 不更新 project memory
- 开启 Memory 创建 session 后：
  - 继续写 raw log
  - 退出后写 summary
  - 更新 project memory
  - renderer 收到 `memory:updated`
- Windows `npm.cmd run build:dir` 成功。
- `npm.cmd test` 成功。
- `node --check` 对 main/preload/renderer/scripts 成功。

## 10. 后续规划

- 抽出 memory 纯逻辑模块，扩大单元测试覆盖。
- 项目详情增加完整 session JSON 查看。
- macOS 正式分发：图标、签名、公证、arm64/x64 验证。
- Linux 打包目标验证。
- 可选 hook 系统，但必须保持默认关闭和本地可控。
