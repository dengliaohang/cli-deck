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

### 4.4 Orchestrator 蜂群任务板

Orchestrator 是面向多个 AI CLI session 的本地调度层。CLI Deck 内部 Task Board 是事实源，Dispatcher 根据任务状态、依赖、worker 能力和运行结果推进任务；Brain session 是可选规划者，worker session 是执行者。

设计原则：

- 不把“向 TUI 粘贴提示词”作为长期核心控制面。PTY prompt 只是当前兼容 adapter。
- Task Board 记录 task、run、event，UI、Brain、worker 结果都围绕这个状态机读写。
- Dispatcher 负责 claim ready task、选择 worker、创建 run、处理 retry/block/cancel/reclaim。
- Worker Adapter 隔离不同 CLI 工具：当前实现 `pty` adapter，后续可接 `codex app-server`、非交互命令、MCP/IPC 写回。
- Brain 负责规划和建议，不进入默认 worker 派发池，也不直接拥有任务真实状态。CLI Deck 根据 worker result 和 task board 状态决定下一步。

MVP 能力：

- 按命令推断能力：
  - Codex: implement / test / review
  - Claude: review / plan / research
  - OpenCode: implement / test
- Custom: custom
- 用户输入 swarm objective 后，开发 / 构建 / 测试 / 复核类目标由 CLI Deck 直接创建 worker task 并按能力派发；普通聊天目标发送给 Brain session。
- task 状态：`ready` / `running` / `blocked` / `done` / `cancelled` / `archived`。
- 每次派发创建 run，记录 run id、worker session、adapter、attempt、result、error。
- Dispatcher 默认排除 Brain session；只有 `target: brain` 或普通聊天目标才会写入 Brain。
- 如果只有 Brain 没有 worker，开发任务会进入 `blocked`，并引导用户创建 worker session 后自动 retry/dispatch。
- worker session 退出但 task 未完成时，CLI Deck 把 task 标记为 `blocked`，并记录 reclaim event。
- UI 展示 worker roster、task board、run/attempt 摘要和事件流。
- 如果没有任何 live CLI session，Dispatch 会弹出创建 Brain 的对话框，让用户选择 CLI 类型、工作目录和 Memory 选项；Brain 启动成功后继续处理刚才的 objective。
- Brain 可接收普通聊天目标、worker result 和 swarm status；当 Brain 输出 `CLI_DECK_COMMAND_ACTUAL_START` / `CLI_DECK_COMMAND_ACTUAL_END` 或 `CLI_DECK_PLAN_ACTUAL_START` / `CLI_DECK_PLAN_ACTUAL_END` 协议块后，CLI Deck 执行后续调度动作。
- 未选择 Brain 时，CLI Deck 会保留当前 objective 并弹出创建 Brain 对话框，避免把用户原始对话误派成 worker 任务。
- Auto dispatch 开启时，Dispatcher 自动选择可用 worker 并通过 Worker Adapter 派发任务。
- 发给 Brain 的 prompt 会压缩为单行普通输入并单独发送 Enter；调度说明必须保持短文本，避免污染普通对话或卡住 TUI 输入。
- Memory 的 frequent commands 会过滤 CLI Deck 注入的 objective / command / plan / result prompt，避免调度文本出现在 Common commands。
- 当前 PTY adapter 发给 worker 的多行任务 prompt 使用 bracketed paste 包裹，再单独发送 Enter，适配 Codex / Claude 这类 TUI 的多行输入提交。
- Brain command 支持 `dispatch` / `status` / `cancel` / `retry` / `message`。
- `dispatch` command 可通过 `target` 指定 session id、session title、能力名或 `brain`；未指定时按 capability 自动选择 worker。
- worker 完成后可输出 `CLI_DECK_RESULT_ACTUAL_START` / `CLI_DECK_RESULT_ACTUAL_END` 协议块触发结果处理。
- CLI Deck 解析 worker 结果后更新任务状态，并优先把结果和当前 swarm status 回传给 Brain。
- 如果没有可用 Brain，CLI Deck 按结果自动排队下一步：
  - `done` / `needs_review` -> review
  - `needs_test` -> test
  - `blocked` -> research

Worker 结果协议：

```text
CLI_DECK_RESULT_ACTUAL_START
task_id: task-1
status: done | blocked | needs_review | needs_test
summary: one sentence summary
details:
- important detail
next:
- suggested next task, or none
CLI_DECK_RESULT_ACTUAL_END
```

Brain 计划协议：

```text
CLI_DECK_PLAN_ACTUAL_START
task: implement | short task for an implement-capable worker
task: review | short task for a review-capable worker
task: test | short task for a test-capable worker
CLI_DECK_PLAN_ACTUAL_END
```

Brain 控制协议：

```text
CLI_DECK_COMMAND_ACTUAL_START
action: dispatch | status | cancel | retry | message
capability: implement | test | review | research | custom
target: session id, session title, capability, or brain
task_id: task-1
task: worker task text
message: direct message for target session
CLI_DECK_COMMAND_ACTUAL_END
```

命令语义：

- `dispatch`: 创建 task，并派发给 `target` 或匹配 `capability` 的 worker。必填 `task`，可选 `capability`、`target`。
- `status`: CLI Deck 把 live sessions、Brain、task 列表写回 Brain terminal。
- `cancel`: 把指定 `task_id` 标记为 `cancelled`，不会强杀已经运行的 CLI 进程。
- `retry`: 把指定 `task_id` 重置为 `ready` 并重新派发。
- `message`: 把 `message` 直接写入 `target` session。

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
  - Orchestrator
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

### 7.4 Orchestrator 面板

Orchestrator 面板在 sidebar 内展示调度目标、worker roster、任务队列和消息流。

交互：

- 选择 Brain session，输入 swarm objective 并 Dispatch。
- Auto 开关控制是否自动派发 ready task。
- worker roster 展示当前 live session 和推断能力。
- Dispatch / Retry 按钮可手动派发单个 ready 或 blocked task。
- Drop 按钮可丢弃任务。
- 消息流展示 objective、dispatch、result、route、blocked 等事件。

## 8. 安全与隐私

- 默认本地存储，不联网。
- 不上传 raw log。
- 不在 renderer 中直接写文件。
- Memory 开关允许用户在敏感 session 中禁用持久化。
- Orchestrator 通过写入当前 PTY 派发任务，不绕过 CLI 自身确认流程。
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
- Orchestrator 能把 objective 发送给选中的 Brain session，并在 Brain 输出 `CLI_DECK_COMMAND_ACTUAL` 后执行 dispatch/status/cancel/retry/message。
- Orchestrator 能解析 `CLI_DECK_PLAN_ACTUAL` 协议块，并按 capability 创建 worker tasks。
- Orchestrator 能解析 `CLI_DECK_RESULT_ACTUAL` 协议块，更新 task 状态，并把 worker result 与 swarm status 回传给 Brain。
- 无可用 Brain 时，Orchestrator 能根据 worker result status 排队 review/test/research 后续任务。
- Windows `npm.cmd run build:dir` 成功。
- `npm.cmd test` 成功。
- `node --check` 对 main/preload/renderer/scripts 成功。

## 10. 后续规划

- 抽出 memory 纯逻辑模块，扩大单元测试覆盖。
- 项目详情增加完整 session JSON 查看。
- macOS 正式分发：图标、签名、公证、arm64/x64 验证。
- Linux 打包目标验证。
- Orchestrator 后续可增加持久化调度历史、任务依赖图、人工确认队列和 worker 能力手动编辑。
- 可选 hook 系统，但必须保持默认关闭和本地可控。
