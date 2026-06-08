# CLI Deck 交接文档

这份文档是给后续接手的工具模型看的。目标是让它快速理解：

- 这个项目现在做到哪了
- 核心数据怎么流
- 哪些文件是关键入口
- 哪些边界不要误判

## 1. 项目一句话

CLI Deck 是一个 Windows 优先的 Electron 桌面工作台，用来在一个大窗口里启动和管理多个 CLI 会话，例如 Codex、Claude Code、OpenCode，并支持平铺展示、输入输出、会话记忆和历史回溯。

当前主要验证平台仍是 Windows，但 session 启动层已经按平台分流：

- Windows 使用 `powershell.exe`
- macOS 使用 `$SHELL`，默认 `/bin/zsh`
- Linux 使用 `$SHELL`，默认 `/bin/sh`

## 2. 当前产品状态

已经实现：

- 在应用内启动 CLI 会话，不再依赖抓取外部命令行窗口。
- 多会话平铺展示，自动按数量调整列数。
- 每个会话可直接输入。
- New Session 表单支持：
  - command 输入 / 下拉
  - args 输入
  - working directory 输入 / 文件夹选择
- 本地 memory 层：
  - session raw log
  - session summary JSON
  - project memory JSON
- 记忆面板：
  - `Current` 当前项目记忆
  - `History` 历史项目列表
  - 历史搜索和筛选
  - 项目详情、重新启动、打开 cwd、打开日志、导出、删除 memory
- raw log 控制：
  - 单 session 默认 20MB 上限
  - 普通 raw log 30 天清理
  - failed raw log 60 天清理
- Settings 面板：
  - presets 编辑
  - default cwd
  - raw log 开关、大小和保留天数
- session 操作：
  - restart / duplicate / rename / copy command / open cwd / close stopped
- macOS / Linux 源码运行的启动层支持

未做或暂不做：

- 不 attach 外部已经运行的 CLI 窗口
- 不调用云端 AI 做摘要
- 不执行用户自定义 hook 脚本
- 不扫描整个源码仓库来自动“学习”代码
- macOS 正式分发签名 / 公证尚未做

## 3. 关键实现思路

### 3.1 会话模型

每个 session 都由应用自己创建和托管。

主流程：

1. renderer 点 `New Session`
2. `main` 用 `node-pty` 启动 CLI
3. `pty.onData` 把输出送回 renderer
4. renderer 把输入发给 main
5. `pty.onExit` 结束时写 summary，更新 project memory

### 3.2 记忆分层

现在不是“AI 记忆”，而是三层本地存储：

#### A. Raw log

原始终端日志，记录 session 实际输出和输入标记。

用途：

- 排错
- 回看完整过程

特点：

- 可能很大
- 有上限
- 会过期清理

#### B. Session summary

session 结束时生成的结构化摘要。

包含：

- session id
- title
- commandLine
- cwd
- status
- exitCode / signal
- duration
- recentOutputLines
- userCommands
- failureHints
- logPath

用途：

- 给历史视图快速预览
- 给 project memory 提供轻量归档

#### C. Project memory

按 working directory 聚合。

包含：

- cwd
- firstSeen / lastSeen
- sessionCount
- toolUsage
- frequentCommands
- knownFailures
- recentSessions
- recentSummaries

用途：

- 当前项目上下文
- 历史追踪
- 后续建议系统的基础

## 4. 存储位置

统一写到 Electron `userData` 下。

结构大致是：

```text
<userData>/memory/
  projects/
    <cwd-hash>.json
  sessions/
    <YYYY-MM-DD>/
      <session-id>.log
      <session-id>.json
```

注意：

- `.log` 是 raw log
- `.json` 是 summary / project memory
- 项目源码目录不会被写入

## 5. 关键文件

- `src/main.js`
  - PTY 启动
  - session 生命周期
  - memory 写入
  - raw log 清理
  - settings 持久化
  - memory 搜索 / 导出 / 删除 / 打开路径
  - IPC handler

- `src/preload.js`
  - 暴露安全 API 给 renderer
  - 只读 memory 查询
  - session 数据收发

- `src/renderer/renderer.js`
  - 终端 UI
  - session tile
  - memory 面板
  - history/current 切换

- `src/renderer/index.html`
  - 页面结构

- `src/renderer/styles.css`
  - 终端和平铺布局样式
  - memory 面板样式
  - 历史列表样式

- `docs/CLI_DECK_MEMORY_PRD.md`
  - memory 层详细 PRD

- `README.md`
  - 用户级说明

## 6. 当前 IPC

### renderer -> main

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

### main -> renderer

- `terminal:data`
- `terminal:exit`
- `memory:updated`

## 7. UI 逻辑

### 7.1 Sessions

左侧展示当前运行中的 session 列表，右侧是平铺终端区。

### 7.2 Memory 面板

Memory 面板有两个模式：

- `Current`
  - 展示当前选中 session 的 cwd 对应 project memory
- `History`
  - 展示所有 project memory 的历史列表

当前没有活动 session 时，默认回到 `History`，避免“记忆消失”的感觉。

### 7.3 历史列表

历史列表展示的是轻量 project memory，不读取 raw log。
支持 query / tool / status / failureCategory 过滤。点击历史项进入项目详情，可打开 raw log、导出 JSON/Markdown、删除 project memory、从项目 cwd 重新启动 session。

每项显示：

- 项目路径
- session 数
- lastSeen
- toolUsage
- frequentCommands
- 最近 summary

## 8. 重要约束

后续修改时请保持这些边界：

- 不要把 project memory 变成完整日志仓库
- 不要把 raw log 无限增长
- 不要在 renderer 里直接写 memory
- 不要默认去抓外部窗口
- 不要重新暴露 `windows:*` IPC，除非正式重启 attach 外部窗口方向并同步更新本文档
- 不要把“摘要”理解成 AI 摘要，当前是规则摘要

## 9. 当前运行方式

Windows 开发：

```powershell
npm.cmd install
npm.cmd start
```

macOS / Linux 开发：

```bash
npm install
npm start
```

Windows 构建目录版：

```powershell
npm.cmd run build:dir
```

输出：

```text
dist/win-unpacked/CLI Deck.exe
```

macOS 目录构建需要在 macOS 上执行：

```bash
npm run build:mac
```

## 10. 如果后续要继续做

建议顺序：

1. 给 session summary 继续增加更清晰的错误归类和去重策略
2. 给 memory 项目详情增加更完整的 session JSON 查看
3. 增加轻量测试，把 memory 纯逻辑从 `main.js` 中抽出
4. 完善 macOS 正式分发：图标、签名、公证、arm64/x64 验证
5. 最后才考虑可配置 hooks 和更强的自动建议
