const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const Store = require('electron-store');
const pty = require('@lydell/node-pty');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('in-process-gpu');
if (process.env.CLI_DECK_PORTABLE_DATA === '1') {
  app.setPath('userData', path.join(__dirname, '..', '.localappdata', 'cli-deck'));
}

const store = new Store({
  defaults: {
    windowBounds: { width: 1240, height: 780 },
    presets: [
      { name: 'Codex', command: 'codex', args: [] },
      { name: 'OpenCode', command: 'opencode', args: [] },
      { name: 'Claude Code', command: 'claude', args: [] }
    ],
    memory: {
      rawLogsEnabled: true,
      maxLogBytes: 20 * 1024 * 1024,
      rawLogRetentionDays: 30,
      failedRawLogRetentionDays: 60
    }
  }
});

const defaultPresets = [
  { name: 'Codex', command: 'codex', args: [] },
  { name: 'OpenCode', command: 'opencode', args: [] },
  { name: 'Claude Code', command: 'claude', args: [] }
];

const sessions = new Map();
let mainWindow;

const DEFAULT_MEMORY_LIMITS = {
  rawLogsEnabled: true,
  maxLogBytes: 20 * 1024 * 1024,
  rawLogRetentionDays: 30,
  failedRawLogRetentionDays: 60
};


function createWindow() {
  const bounds = store.get('windowBounds');
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 560,
    title: 'CLI Deck',
    backgroundColor: '#101318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('resize', () => {
    if (!mainWindow?.isDestroyed()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function quotePowerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quotePosixShellString(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function splitCommandLine(value) {
  const result = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match;

  while ((match = pattern.exec(String(value || '').trim())) !== null) {
    result.push(match[1] ?? match[2] ?? match[0]);
  }

  return result;
}

function buildPowerShellLaunch(command, args) {
  let resolvedCommand = String(command || '').trim();
  let resolvedArgs = Array.isArray(args) ? [...args] : [];

  if (resolvedArgs.length === 0 && /\s/.test(resolvedCommand)) {
    const parts = splitCommandLine(resolvedCommand);
    resolvedCommand = parts.shift() || resolvedCommand;
    resolvedArgs = parts;
  }

  const quoted = [quotePowerShellString(resolvedCommand), ...resolvedArgs.map(quotePowerShellString)];
  return `& ${quoted.join(' ')}; if ($null -ne $global:LASTEXITCODE) { exit $global:LASTEXITCODE }`;
}

function buildPosixShellLaunch(command, args) {
  let resolvedCommand = String(command || '').trim();
  let resolvedArgs = Array.isArray(args) ? [...args] : [];

  if (resolvedArgs.length === 0 && /\s/.test(resolvedCommand)) {
    const parts = splitCommandLine(resolvedCommand);
    resolvedCommand = parts.shift() || resolvedCommand;
    resolvedArgs = parts;
  }

  return [resolvedCommand, ...resolvedArgs].map(quotePosixShellString).join(' ');
}

function getPtyLaunch(command, args) {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildPowerShellLaunch(command, args)]
    };
  }

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return {
    file: shell,
    args: ['-lc', buildPosixShellLaunch(command, args)]
  };
}

function getMemoryRoot() {
  return path.join(app.getPath('userData'), 'memory');
}

function getMemoryConfig() {
  const configured = store.get('memory') || {};
  const maxLogBytes = Number(configured.maxLogBytes);
  const rawLogRetentionDays = Number(configured.rawLogRetentionDays);
  const failedRawLogRetentionDays = Number(configured.failedRawLogRetentionDays);

  return {
    rawLogsEnabled: configured.rawLogsEnabled !== false,
    maxLogBytes: Number.isFinite(maxLogBytes) && maxLogBytes > 0 ? maxLogBytes : DEFAULT_MEMORY_LIMITS.maxLogBytes,
    rawLogRetentionDays:
      Number.isFinite(rawLogRetentionDays) && rawLogRetentionDays > 0
        ? rawLogRetentionDays
        : DEFAULT_MEMORY_LIMITS.rawLogRetentionDays,
    failedRawLogRetentionDays:
      Number.isFinite(failedRawLogRetentionDays) && failedRawLogRetentionDays > 0
        ? failedRawLogRetentionDays
        : DEFAULT_MEMORY_LIMITS.failedRawLogRetentionDays
  };
}

function sanitizePresets(value) {
  const presets = Array.isArray(value) ? value : defaultPresets;
  return presets
    .map((preset) => ({
      name: String(preset?.name || preset?.command || '').trim(),
      command: String(preset?.command || '').trim(),
      args: Array.isArray(preset?.args)
        ? preset.args.map((arg) => String(arg))
        : splitCommandLine(String(preset?.args || ''))
    }))
    .filter((preset) => preset.command);
}

function getAppConfig() {
  return {
    presets: sanitizePresets(store.get('presets')),
    defaultCwd: store.get('defaultCwd') || os.homedir(),
    memory: getMemoryConfig()
  };
}

function saveAppConfig(config = {}) {
  if (Array.isArray(config.presets)) {
    store.set('presets', sanitizePresets(config.presets));
  }

  if (typeof config.defaultCwd === 'string') {
    const value = config.defaultCwd.trim();
    store.set('defaultCwd', value ? normalizeCwd(value) : os.homedir());
  }

  if (config.memory && typeof config.memory === 'object') {
    const current = getMemoryConfig();
    const next = {
      rawLogsEnabled: config.memory.rawLogsEnabled !== false,
      maxLogBytes: Number(config.memory.maxLogBytes),
      rawLogRetentionDays: Number(config.memory.rawLogRetentionDays),
      failedRawLogRetentionDays: Number(config.memory.failedRawLogRetentionDays)
    };
    store.set('memory', {
      rawLogsEnabled: next.rawLogsEnabled,
      maxLogBytes:
        Number.isFinite(next.maxLogBytes) && next.maxLogBytes > 0 ? next.maxLogBytes : current.maxLogBytes,
      rawLogRetentionDays:
        Number.isFinite(next.rawLogRetentionDays) && next.rawLogRetentionDays > 0
          ? next.rawLogRetentionDays
          : current.rawLogRetentionDays,
      failedRawLogRetentionDays:
        Number.isFinite(next.failedRawLogRetentionDays) && next.failedRawLogRetentionDays > 0
          ? next.failedRawLogRetentionDays
          : current.failedRawLogRetentionDays
    });
  }

  return getAppConfig();
}

function normalizeCwd(cwd) {
  const value = String(cwd || os.homedir()).trim() || os.homedir();
  return path.resolve(value);
}

function summarizeCwd(cwd) {
  const normalized = normalizeCwd(cwd);
  const parsed = path.parse(normalized);
  const relative = normalized.slice(parsed.root.length);
  const parts = relative.split(/[\\/]+/).filter(Boolean);

  if (parts.length === 0) {
    return parsed.root || normalized;
  }
  if (parts.length <= 2) {
    return parts.join(path.sep);
  }

  return `${parts.at(-2)}${path.sep}${parts.at(-1)}`;
}

function stripCwdSuffix(title) {
  return String(title || '').replace(/\s+[—-]\s+[^\\/—-]+[\\/][^\\/—-]+$/, '').trim();
}

function buildSessionTitle(config, cwd) {
  const baseTitle = stripCwdSuffix(config.name || config.command || 'Terminal') || 'Terminal';
  return `${baseTitle} — ${summarizeCwd(cwd)}`;
}

function getProjectKey(cwd) {
  return crypto.createHash('sha256').update(normalizeCwd(cwd).toLowerCase()).digest('hex').slice(0, 20);
}

function getProjectMemoryPath(cwd) {
  return path.join(getMemoryRoot(), 'projects', `${getProjectKey(cwd)}.json`);
}

function getProjectMemoryPathByKey(projectKey) {
  const safeKey = String(projectKey || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
  if (!safeKey) {
    throw new Error('Project key is required.');
  }
  return path.join(getMemoryRoot(), 'projects', `${safeKey}.json`);
}

function ensureMemoryDirectories(sessionDate) {
  const root = getMemoryRoot();
  const dirs = [
    root,
    path.join(root, 'projects'),
    path.join(root, 'sessions'),
    path.join(root, 'sessions', sessionDate)
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function stripAnsi(value) {
  return String(value || '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/\r/g, '\n');
}

function toCommandLine(command, args) {
  return [command, ...(Array.isArray(args) ? args : [])].filter(Boolean).join(' ');
}

function classifyTool(command) {
  const value = String(command || '').toLowerCase();
  if (value.includes('opencode')) {
    return 'opencode';
  }
  if (value.includes('claude')) {
    return 'claude';
  }
  if (value.includes('codex')) {
    return 'codex';
  }
  return 'custom';
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function limitArray(values, limit) {
  return values.slice(0, limit);
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function cleanupExpiredRawLogs() {
  const memoryConfig = getMemoryConfig();
  const sessionsRoot = path.join(getMemoryRoot(), 'sessions');
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const result = { deletedLogs: 0, removedDirectories: 0 };

  if (!fs.existsSync(sessionsRoot)) {
    return result;
  }

  try {
    for (const dateEntry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!dateEntry.isDirectory()) {
        continue;
      }

      const sessionDir = path.join(sessionsRoot, dateEntry.name);
      for (const fileEntry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
        if (!fileEntry.isFile() || !fileEntry.name.endsWith('.log')) {
          continue;
        }

        const logPath = path.join(sessionDir, fileEntry.name);
        const metaPath = logPath.replace(/\.log$/i, '.json');
        const meta = readJsonFile(metaPath, null);
        const stat = fs.statSync(logPath);
        const referenceTime = meta?.endTime ? new Date(meta.endTime).getTime() : stat.mtimeMs;
        const retentionDays =
          meta?.status === 'failed' ? memoryConfig.failedRawLogRetentionDays : memoryConfig.rawLogRetentionDays;

        if (Number.isFinite(referenceTime) && now - referenceTime > retentionDays * dayMs) {
          fs.unlinkSync(logPath);
          result.deletedLogs += 1;
        }
      }

      if (fs.readdirSync(sessionDir).length === 0) {
        fs.rmdirSync(sessionDir);
        result.removedDirectories += 1;
      }
    }
  } catch (error) {
    console.error('Failed to clean expired raw logs.', error);
  }

  return result;
}

function writeRecorderLog(recorder, value, options = {}) {
  if (!recorder?.writeStream) {
    return;
  }

  const text = String(value || '');
  const force = options.force === true;
  const byteLength = Buffer.byteLength(text, 'utf8');

  if (!force && !recorder.rawLogsEnabled) {
    return;
  }

  if (!force && recorder.logBytes + byteLength > recorder.maxLogBytes) {
    if (!recorder.rawLogTruncated) {
      const notice = `\n\n[raw log limit reached]\nCLI Deck stopped writing raw terminal output after ${recorder.maxLogBytes} bytes. Session summary and project memory will continue.\n`;
      recorder.writeStream.write(notice);
      recorder.logBytes += Buffer.byteLength(notice, 'utf8');
      recorder.rawLogTruncated = true;
    }
    return;
  }

  recorder.writeStream.write(text);
  recorder.logBytes += byteLength;
}

function createSessionRecorder({ id, title, command, args, cwd }) {
  const startTime = new Date();
  const sessionDate = startTime.toISOString().slice(0, 10);
  ensureMemoryDirectories(sessionDate);
  const memoryConfig = getMemoryConfig();

  const sessionDir = path.join(getMemoryRoot(), 'sessions', sessionDate);
  const logPath = path.join(sessionDir, `${id}.log`);
  const metaPath = path.join(sessionDir, `${id}.json`);
  const normalizedCwd = normalizeCwd(cwd);
  const recorder = {
    id,
    title,
    command,
    args,
    cwd: normalizedCwd,
    commandLine: toCommandLine(command, args),
    startTime: startTime.toISOString(),
    startMs: startTime.getTime(),
    logPath,
    metaPath,
    writeStream: fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' }),
    rawLogsEnabled: memoryConfig.rawLogsEnabled,
    maxLogBytes: memoryConfig.maxLogBytes,
    logBytes: 0,
    rawLogTruncated: false,
    recentOutputLines: [],
    outputCarry: '',
    inputChunks: 0,
    inputBuffer: '',
    userCommands: []
  };

  writeRecorderLog(
    recorder,
    [
      `# CLI Deck session ${id}`,
      `started: ${recorder.startTime}`,
      `title: ${title}`,
      `cwd: ${normalizedCwd}`,
      `command: ${recorder.commandLine}`,
      `rawLogsEnabled: ${recorder.rawLogsEnabled}`,
      `maxLogBytes: ${recorder.maxLogBytes}`,
      '',
      recorder.rawLogsEnabled ? '[output]' : '[raw logging disabled]',
      ''
    ].join('\n'),
    { force: true }
  );

  return recorder;
}

function recordOutput(recorder, data) {
  if (!recorder) {
    return;
  }

  writeRecorderLog(recorder, data);
  const clean = stripAnsi(data);
  const combined = recorder.outputCarry + clean;
  const lines = combined.split('\n');
  recorder.outputCarry = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      recorder.recentOutputLines.push(trimmed);
    }
  }

  if (recorder.recentOutputLines.length > 80) {
    recorder.recentOutputLines = recorder.recentOutputLines.slice(-80);
  }
}

function recordInput(recorder, data) {
  if (!recorder) {
    return;
  }

  recorder.inputChunks += 1;
  writeRecorderLog(recorder, `\n\n[input ${new Date().toISOString()}]\n${data}\n[output]\n`);

  for (const char of String(data || '')) {
    if (char === '\r' || char === '\n') {
      const command = recorder.inputBuffer.trim();
      if (command) {
        recorder.userCommands.unshift(command);
        recorder.userCommands = [...new Set(recorder.userCommands)].slice(0, 20);
      }
      recorder.inputBuffer = '';
      continue;
    }
    if (char === '\u007f' || char === '\b') {
      recorder.inputBuffer = recorder.inputBuffer.slice(0, -1);
      continue;
    }
    if (char >= ' ') {
      recorder.inputBuffer += char;
    }
  }
}

function detectFailureHints(lines) {
  const pattern = /\b(error|failed|failure|exception|traceback|denied|timeout|timed out|not recognized|cannot find|could not|unable to|fatal)\b/i;
  const hints = [];

  for (const line of lines.slice().reverse()) {
    if (pattern.test(line)) {
      hints.unshift(line);
    }
    if (hints.length >= 5) {
      break;
    }
  }

  return hints;
}

function classifyFailureCategory(hints) {
  const text = (Array.isArray(hints) ? hints : []).join('\n').toLowerCase();
  if (!text) {
    return '';
  }
  if (/\b(timeout|timed out)\b/.test(text)) {
    return 'timeout';
  }
  if (/\b(denied|permission|eacces|unauthorized|forbidden)\b/.test(text)) {
    return 'permission';
  }
  if (/\b(not recognized|command not found|cannot find|not found)\b/.test(text)) {
    return 'command';
  }
  if (/\b(exception|traceback|stack trace)\b/.test(text)) {
    return 'exception';
  }
  if (/\b(build failed|compilation failure|compile failed|test failed|tests failed)\b/.test(text)) {
    return 'build';
  }
  if (/\b(network|econn|dns|proxy|certificate|ssl|tls)\b/.test(text)) {
    return 'network';
  }
  return 'general';
}

function buildSessionSummary(recorder, exitCode, signal) {
  const endTime = new Date();
  const durationMs = endTime.getTime() - recorder.startMs;
  const status = signal ? 'stopped' : exitCode === 0 ? 'succeeded' : 'failed';
  const recentOutputLines = recorder.recentOutputLines.slice(-12);
  const failureHints = detectFailureHints(recorder.recentOutputLines);
  const failureCategory = classifyFailureCategory(failureHints);
  const textParts = [
    `${recorder.title} ${status} after ${formatDuration(durationMs)}.`,
    `Command: ${recorder.commandLine}.`,
    `Working directory: ${recorder.cwd}.`
  ];

  if (recorder.userCommands.length > 0) {
    textParts.push(`Recent input: ${recorder.userCommands.slice(0, 3).join(' | ')}.`);
  }
  if (failureHints.length > 0) {
    textParts.push(`Failure hint: ${failureHints[failureHints.length - 1]}.`);
  }

  return {
    id: recorder.id,
    title: recorder.title,
    command: recorder.command,
    args: recorder.args,
    commandLine: recorder.commandLine,
    cwd: recorder.cwd,
    tool: classifyTool(recorder.command),
    status,
    exitCode,
    signal,
    startTime: recorder.startTime,
    endTime: endTime.toISOString(),
    durationMs,
    durationText: formatDuration(durationMs),
    inputChunks: recorder.inputChunks,
    userCommands: recorder.userCommands.slice(0, 20),
    recentOutputLines,
    failureHints,
    failureCategory,
    logPath: recorder.logPath,
    metaPath: recorder.metaPath,
    rawLogsEnabled: recorder.rawLogsEnabled,
    rawLogTruncated: recorder.rawLogTruncated,
    logBytes: recorder.logBytes,
    maxLogBytes: recorder.maxLogBytes,
    text: textParts.join(' ')
  };
}

function loadProjectMemory(cwd) {
  const normalizedCwd = normalizeCwd(cwd);
  const projectPath = getProjectMemoryPath(normalizedCwd);
  const memory = readJsonFile(projectPath, null);

  if (memory) {
    return memory;
  }

  return {
    cwd: normalizedCwd,
    projectKey: getProjectKey(normalizedCwd),
    firstSeen: null,
    lastSeen: null,
    sessionCount: 0,
    toolUsage: {},
    frequentCommands: [],
    knownFailures: [],
    recentSessions: [],
    recentSummaries: []
  };
}

function compactProjectMemory(memory) {
  return {
    cwd: memory.cwd,
    projectKey: memory.projectKey,
    firstSeen: memory.firstSeen,
    lastSeen: memory.lastSeen,
    sessionCount: Number(memory.sessionCount || 0),
    toolUsage: memory.toolUsage || {},
    frequentCommands: Array.isArray(memory.frequentCommands) ? memory.frequentCommands.slice(0, 5) : [],
    knownFailures: Array.isArray(memory.knownFailures) ? memory.knownFailures.slice(0, 3) : [],
    recentSessions: Array.isArray(memory.recentSessions) ? memory.recentSessions.slice(0, 5) : [],
    recentSummaries: Array.isArray(memory.recentSummaries) ? memory.recentSummaries.slice(0, 5) : []
  };
}

function listProjectMemories(limit = 30) {
  const projectsDir = path.join(getMemoryRoot(), 'projects');
  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const memories = [];
  try {
    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const memory = readJsonFile(path.join(projectsDir, entry.name), null);
      if (memory?.cwd) {
        memories.push(compactProjectMemory(memory));
      }
    }
  } catch (error) {
    console.error('Failed to list project memories.', error);
  }

  return memories
    .sort((a, b) => new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime())
    .slice(0, limit);
}

function loadProjectMemoryByKey(projectKey) {
  const memory = readJsonFile(getProjectMemoryPathByKey(projectKey), null);
  return memory?.cwd ? memory : null;
}

function searchProjectMemories(options = {}) {
  const query = String(options.query || '').trim().toLowerCase();
  const tool = String(options.tool || 'all').trim().toLowerCase();
  const status = String(options.status || 'all').trim().toLowerCase();
  const failureCategory = String(options.failureCategory || 'all').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);

  return listProjectMemories(500)
    .filter((memory) => {
      if (query) {
        const haystack = [
          memory.cwd,
          ...(memory.frequentCommands || []).map((item) => item.command),
          ...(memory.knownFailures || []).map((item) => item.text),
          ...(memory.recentSummaries || []).map((item) => item.text)
        ]
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      if (tool !== 'all' && Number(memory.toolUsage?.[tool] || 0) <= 0) {
        return false;
      }

      if (status !== 'all') {
        const summaries = Array.isArray(memory.recentSummaries) ? memory.recentSummaries : [];
        if (!summaries.some((summary) => String(summary.status || '').toLowerCase() === status)) {
          return false;
        }
      }

      if (failureCategory !== 'all') {
        const failures = Array.isArray(memory.knownFailures) ? memory.knownFailures : [];
        const summaries = Array.isArray(memory.recentSummaries) ? memory.recentSummaries : [];
        if (
          !failures.some((failure) => String(failure.category || '').toLowerCase() === failureCategory) &&
          !summaries.some((summary) => String(summary.failureCategory || '').toLowerCase() === failureCategory)
        ) {
          return false;
        }
      }

      return true;
    })
    .slice(0, limit);
}

function sessionSummaryToMarkdown(summary) {
  const lines = [
    `### ${summary.title || summary.id}`,
    '',
    `- Status: ${summary.status || 'unknown'}`,
    `- Command: \`${summary.commandLine || ''}\``,
    `- Started: ${summary.startTime || ''}`,
    `- Ended: ${summary.endTime || ''}`,
    `- Duration: ${summary.durationText || ''}`,
    `- Log: \`${summary.logPath || ''}\``
  ];

  if (summary.failureCategory) {
    lines.push(`- Failure category: ${summary.failureCategory}`);
  }
  if (Array.isArray(summary.failureHints) && summary.failureHints.length > 0) {
    lines.push('', 'Failure hints:');
    for (const hint of summary.failureHints) {
      lines.push(`- ${hint}`);
    }
  }
  if (Array.isArray(summary.recentOutputLines) && summary.recentOutputLines.length > 0) {
    lines.push('', 'Recent output:', '```text', ...summary.recentOutputLines, '```');
  }
  return lines.join('\n');
}

function projectMemoryToMarkdown(memory) {
  const lines = [
    `# CLI Deck memory`,
    '',
    `Project: \`${memory.cwd}\``,
    '',
    `- Sessions: ${memory.sessionCount || 0}`,
    `- First seen: ${memory.firstSeen || ''}`,
    `- Last seen: ${memory.lastSeen || ''}`,
    '',
    '## Tool usage'
  ];

  const toolEntries = Object.entries(memory.toolUsage || {});
  if (toolEntries.length === 0) {
    lines.push('- None');
  } else {
    for (const [tool, count] of toolEntries) {
      lines.push(`- ${tool}: ${count}`);
    }
  }

  lines.push('', '## Frequent commands');
  const commands = Array.isArray(memory.frequentCommands) ? memory.frequentCommands : [];
  if (commands.length === 0) {
    lines.push('- None');
  } else {
    for (const command of commands) {
      lines.push(`- \`${command.command}\` (${command.count})`);
    }
  }

  lines.push('', '## Known failures');
  const failures = Array.isArray(memory.knownFailures) ? memory.knownFailures : [];
  if (failures.length === 0) {
    lines.push('- None');
  } else {
    for (const failure of failures) {
      lines.push(`- [${failure.category || 'general'}] ${failure.text}`);
    }
  }

  lines.push('', '## Recent sessions');
  const summaries = Array.isArray(memory.recentSessions) ? memory.recentSessions : [];
  if (summaries.length === 0) {
    lines.push('- None');
  } else {
    for (const summary of summaries) {
      lines.push('', sessionSummaryToMarkdown(summary));
    }
  }

  return `${lines.join('\n')}\n`;
}

function exportProjectMemory(projectKey, format = 'json') {
  const memory = loadProjectMemoryByKey(projectKey);
  if (!memory) {
    throw new Error('Project memory was not found.');
  }

  const extension = format === 'markdown' ? 'md' : 'json';
  const safeName = path.basename(memory.cwd).replace(/[^\w.-]+/g, '-') || 'project';
  const outputDir = path.join(getMemoryRoot(), 'exports');
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${safeName}-${memory.projectKey}.${extension}`);
  const content = format === 'markdown' ? projectMemoryToMarkdown(memory) : `${JSON.stringify(memory, null, 2)}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  return { filePath, format: extension };
}

function deleteProjectMemory(projectKey, options = {}) {
  const memory = loadProjectMemoryByKey(projectKey);
  if (!memory) {
    return { deletedProject: false, deletedSessionFiles: 0 };
  }

  const memoryPath = getProjectMemoryPathByKey(projectKey);
  let deletedSessionFiles = 0;

  if (options.deleteSessionFiles === true) {
    const sessionIds = new Set([
      ...(memory.recentSessions || []).map((item) => item.id),
      ...(memory.recentSummaries || []).map((item) => item.id)
    ]);
    const sessionsRoot = path.join(getMemoryRoot(), 'sessions');
    if (fs.existsSync(sessionsRoot)) {
      for (const dateEntry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!dateEntry.isDirectory()) {
          continue;
        }
        const sessionDir = path.join(sessionsRoot, dateEntry.name);
        for (const fileEntry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
          if (!fileEntry.isFile()) {
            continue;
          }
          const id = fileEntry.name.replace(/\.(json|log)$/i, '');
          if (sessionIds.has(id)) {
            fs.unlinkSync(path.join(sessionDir, fileEntry.name));
            deletedSessionFiles += 1;
          }
        }
      }
    }
  }

  fs.unlinkSync(memoryPath);
  return { deletedProject: true, deletedSessionFiles };
}

function incrementFrequentCommand(commands, commandLine) {
  const value = String(commandLine || '').trim();
  if (!value) {
    return commands;
  }

  const next = [...commands];
  const existing = next.find((item) => item.command === value);
  if (existing) {
    existing.count += 1;
    existing.lastUsed = new Date().toISOString();
  } else {
    next.push({ command: value, count: 1, lastUsed: new Date().toISOString() });
  }

  return next.sort((a, b) => b.count - a.count || String(b.lastUsed).localeCompare(String(a.lastUsed))).slice(0, 20);
}

function updateProjectMemory(summary) {
  const now = new Date().toISOString();
  const memory = loadProjectMemory(summary.cwd);
  memory.firstSeen = memory.firstSeen || summary.startTime || now;
  memory.lastSeen = now;
  memory.sessionCount = Number(memory.sessionCount || 0) + 1;
  memory.toolUsage = {
    ...(memory.toolUsage || {}),
    [summary.tool]: Number(memory.toolUsage?.[summary.tool] || 0) + 1
  };

  let frequentCommands = Array.isArray(memory.frequentCommands) ? memory.frequentCommands : [];
  frequentCommands = incrementFrequentCommand(frequentCommands, summary.commandLine);
  for (const command of summary.userCommands || []) {
    frequentCommands = incrementFrequentCommand(frequentCommands, command);
  }

  const recentSession = {
    id: summary.id,
    title: summary.title,
    commandLine: summary.commandLine,
    status: summary.status,
    exitCode: summary.exitCode,
    startTime: summary.startTime,
    endTime: summary.endTime,
    durationText: summary.durationText,
    logPath: summary.logPath,
    rawLogTruncated: summary.rawLogTruncated
  };
  const recentSummary = {
    id: summary.id,
    time: summary.endTime,
    status: summary.status,
    text: summary.text,
    logPath: summary.logPath,
    rawLogTruncated: summary.rawLogTruncated,
    failureHints: summary.failureHints,
    failureCategory: summary.failureCategory
  };

  const knownFailures = Array.isArray(memory.knownFailures) ? memory.knownFailures : [];
  for (const hint of summary.failureHints || []) {
    if (!knownFailures.some((item) => item.text === hint)) {
      knownFailures.unshift({
        text: hint,
        category: summary.failureCategory || 'general',
        sessionId: summary.id,
        time: summary.endTime
      });
    }
  }

  memory.frequentCommands = frequentCommands;
  memory.knownFailures = limitArray(knownFailures, 20);
  memory.recentSessions = limitArray([recentSession, ...(memory.recentSessions || [])], 20);
  memory.recentSummaries = limitArray([recentSummary, ...(memory.recentSummaries || [])], 20);

  writeJsonFile(getProjectMemoryPath(summary.cwd), memory);
  return memory;
}

function finalizeSessionRecorder(recorder, exitCode, signal) {
  if (!recorder) {
    return null;
  }

  const summary = buildSessionSummary(recorder, exitCode, signal);
  try {
    writeRecorderLog(recorder, `\n\n[exit]\ncode: ${exitCode}\nsignal: ${signal || ''}\nended: ${summary.endTime}\n`, {
      force: true
    });
    recorder.writeStream.end();
  } catch (error) {
    console.error('Failed to close session log.', error);
  }

  try {
    writeJsonFile(recorder.metaPath, summary);
    return updateProjectMemory(summary);
  } catch (error) {
    console.error('Failed to persist session memory.', error);
    return null;
  }
}

function spawnSession(config) {
  const id = crypto.randomUUID();
  const cols = Number(config.cols) || 100;
  const rows = Number(config.rows) || 30;
  const args = Array.isArray(config.args) ? config.args : [];
  const cwd = normalizeCwd(config.cwd || os.homedir());
  const title = buildSessionTitle(config, cwd);
  const launch = getPtyLaunch(config.command, args);
  const memoryEnabled = config.memoryEnabled !== false;
  const recorder = memoryEnabled ? createSessionRecorder({ id, title, command: config.command, args, cwd }) : null;

  let proc;
  try {
    proc = pty.spawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    });
  } catch (error) {
    if (recorder) {
      writeRecorderLog(recorder, `\n\n[start failed]\n${error.message}\n`, { force: true });
      recorder.writeStream.end();
    }
    throw error;
  }

  sessions.set(id, {
    id,
    title,
    command: config.command,
    args,
    cwd,
    proc,
    recorder
  });

  proc.onData((data) => {
    recordOutput(recorder, data);
    sendToRenderer('terminal:data', { id, data });
  });

  proc.onExit(({ exitCode, signal }) => {
    sessions.delete(id);
    const projectMemory = finalizeSessionRecorder(recorder, exitCode, signal);
    if (projectMemory) {
      sendToRenderer('memory:updated', { cwd, memory: projectMemory });
    }
    sendToRenderer('terminal:exit', { id, exitCode, signal });
  });

  return { id, title, command: config.command, args, cwd, memoryEnabled };
}

app.whenReady().then(() => {
  createWindow();
  cleanupExpiredRawLogs();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  for (const session of sessions.values()) {
    session.proc.kill();
  }
  sessions.clear();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('app:getConfig', () => getAppConfig());

ipcMain.handle('app:saveConfig', (_event, config) => saveAppConfig(config));

ipcMain.handle('app:selectDirectory', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select working directory'
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('app:openPath', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') {
    return false;
  }
  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error('Path does not exist.');
  }
  const error = await shell.openPath(resolvedPath);
  if (error) {
    throw new Error(error);
  }
  return true;
});

ipcMain.handle('app:readClipboardText', () => clipboard.readText());

ipcMain.handle('app:writeClipboardText', (_event, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

ipcMain.handle('memory:getProject', (_event, cwd) => {
  if (!cwd || typeof cwd !== 'string') {
    return null;
  }
  return loadProjectMemory(cwd);
});

ipcMain.handle('memory:getProjectByKey', (_event, projectKey) => loadProjectMemoryByKey(projectKey));

ipcMain.handle('memory:listProjects', (_event, limit) => listProjectMemories(Number(limit) || 30));

ipcMain.handle('memory:searchProjects', (_event, options) => searchProjectMemories(options || {}));

ipcMain.handle('memory:exportProject', (_event, { projectKey, format }) => exportProjectMemory(projectKey, format));

ipcMain.handle('memory:deleteProject', (_event, { projectKey, deleteSessionFiles }) =>
  deleteProjectMemory(projectKey, { deleteSessionFiles })
);

ipcMain.handle('memory:cleanupRawLogs', () => cleanupExpiredRawLogs());

ipcMain.handle('terminal:create', (_event, config) => {
  if (!config?.command || typeof config.command !== 'string') {
    throw new Error('Command is required.');
  }
  return spawnSession(config);
});

ipcMain.on('terminal:input', (_event, { id, data }) => {
  const session = sessions.get(id);
  if (session && typeof data === 'string') {
    recordInput(session.recorder, data);
    session.proc.write(data);
  }
});

ipcMain.on('terminal:resize', (_event, { id, cols, rows }) => {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  session.proc.resize(Math.max(2, cols), Math.max(2, rows));
});

ipcMain.on('terminal:close', (_event, id) => {
  const session = sessions.get(id);
  if (session) {
    session.proc.kill();
    sessions.delete(id);
  }
});
