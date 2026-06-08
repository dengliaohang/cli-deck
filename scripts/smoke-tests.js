const assert = require('node:assert/strict');

function splitArgs(value) {
  const result = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match;

  while ((match = pattern.exec(String(value || '').trim())) !== null) {
    result.push(match[1] ?? match[2] ?? match[0]);
  }

  return result;
}

function quotePosixShellString(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function buildPosixShellLaunch(command, args) {
  let resolvedCommand = String(command || '').trim();
  let resolvedArgs = Array.isArray(args) ? [...args] : [];

  if (resolvedArgs.length === 0 && /\s/.test(resolvedCommand)) {
    const parts = splitArgs(resolvedCommand);
    resolvedCommand = parts.shift() || resolvedCommand;
    resolvedArgs = parts;
  }

  return [resolvedCommand, ...resolvedArgs].map(quotePosixShellString).join(' ');
}

function parsePresetsText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [namePart, commandPart] = line.includes('|') ? line.split('|', 2) : ['', line];
      const args = splitArgs(commandPart || '');
      const command = args.shift() || '';
      return {
        name: namePart.trim() || command,
        command,
        args
      };
    })
    .filter((preset) => preset.command);
}

function summarizeCwd(cwd) {
  const parts = String(cwd || '')
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return String(cwd || '').trim() || 'cwd';
  }
  if (parts.length <= 2) {
    return parts.join('/');
  }
  return `${parts.at(-2)}/${parts.at(-1)}`;
}

function stripCwdSuffix(title) {
  return String(title || '').replace(/\s+[—-]\s+[^\\/—-]+[\\/][^\\/—-]+$/, '').trim();
}

function buildSessionTitle(config) {
  const baseTitle = stripCwdSuffix(config.name || config.command || 'Terminal') || 'Terminal';
  return `${baseTitle} — ${summarizeCwd(config.cwd)}`;
}

function isSessionMemoryEnabled(config) {
  return config.memoryEnabled !== false;
}

function isTextPasteShortcut(event) {
  if (!event || String(event.key || '').toLowerCase() !== 'v') {
    return false;
  }

  if (event.metaKey) {
    return true;
  }

  return event.ctrlKey && !event.altKey;
}

function normalizeRecordedInput(value) {
  return String(value || '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/\r/g, '\n')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gi, '')
    .replace(/\x1b/g, '')
    .replace(/\[[0-?]*[hl]/gi, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMemoryCommandCandidate(value) {
  const command = normalizeRecordedInput(value);
  if (!command || command.length > 240) {
    return false;
  }

  const lower = command.toLowerCase();
  return !(
    lower.includes('you are the selected cli deck swarm brain') ||
    lower.includes('you are the cli deck swarm brain') ||
    lower.includes('cli deck swarm task') ||
    lower.includes('cli_deck_command_actual') ||
    lower.includes('cli_deck_plan_actual') ||
    lower.includes('cli_deck_result_actual') ||
    lower.startsWith('objective:') ||
    lower.startsWith('user objective:')
  );
}

function classifyCommand(command) {
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

function searchProjectMemories(memories, options = {}) {
  const query = String(options.query || '').trim().toLowerCase();
  const tool = String(options.tool || 'all').trim().toLowerCase();
  const status = String(options.status || 'all').trim().toLowerCase();
  const failureCategory = String(options.failureCategory || 'all').trim().toLowerCase();

  return memories.filter((memory) => {
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
  });
}

function inferCapabilities(command) {
  const tool = classifyCommand(command);
  if (tool === 'codex') {
    return ['implement', 'test', 'review'];
  }
  if (tool === 'claude') {
    return ['review', 'plan', 'research'];
  }
  if (tool === 'opencode') {
    return ['implement', 'test'];
  }
  return ['custom'];
}

function getTestWorkerSessions(sessions, brainSessionId) {
  return sessions.filter((session) => !session.exited && session.id !== brainSessionId && session.orchestratorRole !== 'brain');
}

function getTestWorkerSessionsWithHeadless(sessions, brainSessionId, headless = []) {
  return [...headless, ...getTestWorkerSessions(sessions, brainSessionId)];
}

function findTestSessionForCapability(sessions, capability, brainSessionId = '') {
  const workers = getTestWorkerSessions(sessions, brainSessionId);
  return (
    workers.find((session) => session.capabilities.includes(capability)) ||
    workers.find((session) => session.capabilities.includes('custom')) ||
    null
  );
}

function inferHeadlessResult(taskId, output) {
  return {
    taskId,
    status: Number(output?.exitCode) === 0 ? 'done' : 'blocked',
    summary: output?.stdout || output?.stderr || output?.error || 'No output'
  };
}

function findTestSessionForTarget(sessions, target, capability = '', brainSessionId = '') {
  const value = String(target || '').trim().toLowerCase();
  const brain = sessions.find((session) => session.id === brainSessionId && !session.exited) || null;
  if (value === 'brain') {
    return brain;
  }
  const workers = getTestWorkerSessions(sessions, brainSessionId);
  if (value) {
    const byIdentity = workers.find(
      (session) => session.id.toLowerCase() === value || session.title.toLowerCase() === value
    );
    if (byIdentity) {
      return byIdentity;
    }
    const byCapability = workers.find((session) => session.capabilities.includes(value));
    if (byCapability) {
      return byCapability;
    }
  }
  return capability ? findTestSessionForCapability(sessions, capability, brainSessionId) : null;
}

function isDevelopmentObjective(value) {
  const text = String(value || '').toLowerCase();
  return /(\b(code|program|script|app|feature|implement|build|test|review|fix|debug|refactor)\b|编写|写一|写个|程序|代码|实现|开发|修复|测试|构建|重构|复核)/i.test(text);
}

function parseResultBlock(block) {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const result = { taskId: '', status: 'done', summary: '', details: [], next: '' };
  let section = '';

  for (const line of lines) {
    if (
      line === 'CLI_DECK_RESULT_START' ||
      line === 'CLI_DECK_RESULT_END' ||
      line === 'CLI_DECK_RESULT_ACTUAL_START' ||
      line === 'CLI_DECK_RESULT_ACTUAL_END' ||
      line === 'CLI_DECK_PLAN_ACTUAL_START' ||
      line === 'CLI_DECK_PLAN_ACTUAL_END' ||
      line === 'CLI_DECK_COMMAND_ACTUAL_START' ||
      line === 'CLI_DECK_COMMAND_ACTUAL_END'
    ) {
      continue;
    }
    const match = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (match) {
      section = match[1].toLowerCase();
      const value = match[2].trim();
      if (section === 'task_id') result.taskId = value;
      if (section === 'status') result.status = value;
      if (section === 'summary') result.summary = value;
      if (section === 'next') result.next = value;
      continue;
    }
    if (section === 'details') {
      result.details.push(line.replace(/^-\s*/, ''));
    }
  }
  return result;
}

function parseCommandBlock(block) {
  const command = { action: '', capability: 'implement', task: '', taskId: '', target: '', message: '', auto: '' };
  let section = '';
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === 'CLI_DECK_COMMAND_ACTUAL_START' || line === 'CLI_DECK_COMMAND_ACTUAL_END') {
      continue;
    }
    const match = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (match) {
      section = match[1].toLowerCase();
      const value = match[2].trim();
      if (section === 'action') command.action = value.toLowerCase();
      if (section === 'capability') command.capability = value.toLowerCase() || 'implement';
      if (section === 'task' || section === 'title') command.task = value;
      if (section === 'task_id') command.taskId = value;
      if (section === 'target' || section === 'session') command.target = value;
      if (section === 'message') command.message = value;
      if (section === 'auto') command.auto = value.toLowerCase();
      continue;
    }
    if (section === 'task' || section === 'title') {
      command.task = [command.task, line.replace(/^-\s*/, '')].filter(Boolean).join('\n');
    }
    if (section === 'message') {
      command.message = [command.message, line.replace(/^-\s*/, '')].filter(Boolean).join('\n');
    }
  }
  return command;
}

function parsePlanBlock(block) {
  const tasks = [];
  for (const line of block.split(/\r?\n/)) {
    const match = line.trim().match(/^task:\s*([a-z_]+)\s*\|\s*(.+)$/i);
    if (match) {
      tasks.push({ capability: match[1].toLowerCase(), title: match[2].trim() });
    }
  }
  return tasks;
}

function consumeOrchestratorBlocks(buffer) {
  const events = [];
  const definitions = [
    {
      start: 'CLI_DECK_PLAN_ACTUAL_START',
      end: 'CLI_DECK_PLAN_ACTUAL_END',
      parse: (block) => ({ type: 'plan', tasks: parsePlanBlock(block) })
    },
    {
      start: 'CLI_DECK_RESULT_ACTUAL_START',
      end: 'CLI_DECK_RESULT_ACTUAL_END',
      parse: (block) => ({ type: 'result', result: parseResultBlock(block) })
    },
    {
      start: 'CLI_DECK_COMMAND_ACTUAL_START',
      end: 'CLI_DECK_COMMAND_ACTUAL_END',
      parse: (block) => ({ type: 'command', command: parseCommandBlock(block) })
    }
  ];

  while (true) {
    const next = definitions
      .map((definition) => ({ ...definition, index: buffer.indexOf(definition.start) }))
      .filter((definition) => definition.index !== -1)
      .sort((left, right) => left.index - right.index)[0];
    if (!next) break;
    const end = buffer.indexOf(next.end, next.index + next.start.length);
    if (end === -1) break;
    const blockEnd = end + next.end.length;
    events.push(next.parse(buffer.slice(next.index, blockEnd)));
    buffer = buffer.slice(blockEnd);
  }

  return events;
}

function buildTypedPromptWrites(prompt) {
  return [String(prompt || ''), '\r', '\n'];
}

function buildPastedPromptWrites(prompt) {
  return [`\x1b[200~${prompt}\x1b[201~`, '\r'];
}

function compactPromptText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

function chooseNextCapability(result, completedTask = null) {
  const completedCapability = completedTask?.capability || '';
  if (result.status === 'blocked') {
    return 'research';
  }
  if (result.status === 'needs_review') {
    return 'review';
  }
  if (result.status === 'needs_test') {
    return 'test';
  }
  if (result.status === 'done' && completedCapability === 'implement') {
    return 'review';
  }
  if (result.status === 'done' && completedCapability === 'review') {
    return 'test';
  }
  return '';
}

function createTestTask(board, title, capability = 'implement') {
  const task = {
    id: `task-${board.nextTaskNumber++}`,
    title: String(title || '').trim(),
    capability,
    status: 'ready',
    assignedSessionId: null,
    currentRunId: null,
    attempts: 0,
    result: null,
    blockedReason: ''
  };
  board.tasks.unshift(task);
  return task;
}

function claimTestTask(board, task, session, adapter = 'pty') {
  if (!task || !session || !['ready', 'blocked'].includes(task.status)) {
    return null;
  }
  const run = {
    id: `run-${board.nextRunNumber++}`,
    taskId: task.id,
    sessionId: session.id,
    adapter,
    status: 'running'
  };
  board.runs.unshift(run);
  task.status = 'running';
  task.assignedSessionId = session.id;
  task.currentRunId = run.id;
  task.attempts += 1;
  task.blockedReason = '';
  return run;
}

function finishTestTask(board, task, result, status = 'done') {
  const run = board.runs.find((item) => item.id === task.currentRunId);
  if (run) {
    run.status = status;
    run.result = result;
  }
  task.status = status;
  task.result = result;
  task.currentRunId = null;
  task.blockedReason = status === 'blocked' ? result?.summary || 'Worker blocked' : '';
}

function retryTestTask(task) {
  task.status = 'ready';
  task.assignedSessionId = null;
  task.currentRunId = null;
  task.result = null;
  task.blockedReason = '';
}

function chooseObjectiveRoute(objective, liveSessionCount, hasBrain) {
  if (isDevelopmentObjective(objective)) {
    return 'worker_task';
  }
  if (hasBrain) {
    return 'brain_chat';
  }
  if (liveSessionCount === 0) {
    return 'create_brain';
  }
  return 'create_brain';
}

function restoreTestBoard(board = {}) {
  const restored = {
    tasks: Array.isArray(board.tasks) ? board.tasks : [],
    runs: Array.isArray(board.runs) ? board.runs : [],
    events: Array.isArray(board.events) ? board.events : [],
    nextTaskNumber: Math.max(1, Number(board.nextTaskNumber) || 1),
    nextRunNumber: Math.max(1, Number(board.nextRunNumber) || 1)
  };
  for (const task of restored.tasks) {
    if (task.status !== 'running') {
      continue;
    }
    const run = restored.runs.find((item) => item.id === task.currentRunId);
    if (run) {
      run.status = 'blocked';
      run.error = 'App restarted before worker reported a result.';
    }
    task.status = 'blocked';
    task.blockedReason = 'App restarted before worker reported a result.';
    task.currentRunId = null;
    restored.events.unshift({ kind: 'reclaimed', taskId: task.id });
  }
  return restored;
}

function canTestDispatcherRetryBlockedTask(task) {
  const reason = String(task?.blockedReason || '').toLowerCase();
  return (
    task?.status === 'blocked' &&
    (reason.includes('no live cli session') ||
      reason.includes('no worker') ||
      reason.includes('app restarted before worker reported a result'))
  );
}

function getTestDispatchableTasks(tasks) {
  return tasks.filter((task) => task.status === 'ready' || canTestDispatcherRetryBlockedTask(task));
}

const presets = parsePresetsText('Codex | codex --model gpt-5\nClaude | claude "hello world"\nopencode');
assert.deepEqual(presets, [
  { name: 'Codex', command: 'codex', args: ['--model', 'gpt-5'] },
  { name: 'Claude', command: 'claude', args: ['hello world'] },
  { name: 'opencode', command: 'opencode', args: [] }
]);
assert.equal(buildPosixShellLaunch('codex', ['--prompt', "don't stop"]), `'codex' '--prompt' 'don'"'"'t stop'`);
assert.equal(buildPosixShellLaunch('codex --model gpt-5', []), `'codex' '--model' 'gpt-5'`);
assert.equal(summarizeCwd('C:/development/workspace/tools'), 'workspace/tools');
assert.equal(buildSessionTitle({ name: 'Codex', cwd: 'C:/development/workspace/tools' }), 'Codex — workspace/tools');
assert.equal(
  buildSessionTitle({ name: 'Codex — workspace/tools', cwd: 'C:/development/workspace/tools' }),
  'Codex — workspace/tools'
);
assert.equal(isSessionMemoryEnabled({}), true);
assert.equal(isSessionMemoryEnabled({ memoryEnabled: true }), true);
assert.equal(isSessionMemoryEnabled({ memoryEnabled: false }), false);
assert.equal(isTextPasteShortcut({ key: 'v', ctrlKey: true, altKey: false, metaKey: false }), true);
assert.equal(isTextPasteShortcut({ key: 'V', ctrlKey: true, altKey: false, metaKey: false }), true);
assert.equal(isTextPasteShortcut({ key: 'v', ctrlKey: false, altKey: false, metaKey: true }), true);
assert.equal(isTextPasteShortcut({ key: 'v', ctrlKey: true, altKey: true, metaKey: false }), false);
assert.equal(isTextPasteShortcut({ key: 'c', ctrlKey: true, altKey: false, metaKey: false }), false);
assert.deepEqual(inferCapabilities('codex'), ['implement', 'test', 'review']);
assert.deepEqual(inferCapabilities('claude'), ['review', 'plan', 'research']);
assert.deepEqual(inferCapabilities('opencode'), ['implement', 'test']);
const brainOnlySessions = [{ id: 'brain-1', title: 'Brain codex', capabilities: ['implement', 'test', 'review'] }];
assert.equal(findTestSessionForCapability(brainOnlySessions, 'implement', 'brain-1'), null);
const workerSessions = [
  ...brainOnlySessions,
  { id: 'worker-1', title: 'Worker codex', capabilities: ['implement', 'test', 'review'] }
];
assert.equal(findTestSessionForCapability(workerSessions, 'implement', 'brain-1').id, 'worker-1');
assert.equal(
  getTestWorkerSessionsWithHeadless(brainOnlySessions, 'brain-1', [
    { id: 'headless-codex-exec', capabilities: ['implement'] }
  ])[0].id,
  'headless-codex-exec'
);
assert.equal(findTestSessionForTarget(workerSessions, 'brain', 'implement', 'brain-1').id, 'brain-1');
assert.equal(findTestSessionForTarget(workerSessions, 'Brain codex', 'implement', 'brain-1').id, 'worker-1');
assert.equal(isDevelopmentObjective('编写一个hello程序'), true);
assert.equal(isDevelopmentObjective('fix paste handling'), true);
assert.equal(isDevelopmentObjective('介绍一下你自己'), false);
assert.equal(chooseObjectiveRoute('编写一个hello程序', 0, false), 'worker_task');
assert.equal(chooseObjectiveRoute('介绍一下你自己', 0, false), 'create_brain');
assert.equal(chooseObjectiveRoute('介绍一下你自己', 1, true), 'brain_chat');
const parsedResult = parseResultBlock(`
CLI_DECK_RESULT_ACTUAL_START
task_id: task-1
status: needs_review
summary: implemented the feature
details:
- changed renderer
next:
- review the diff
CLI_DECK_RESULT_ACTUAL_END
`);
assert.equal(parsedResult.taskId, 'task-1');
assert.equal(parsedResult.status, 'needs_review');
assert.equal(parsedResult.summary, 'implemented the feature');
assert.deepEqual(parsedResult.details, ['changed renderer']);
assert.equal(chooseNextCapability(parsedResult), 'review');
assert.deepEqual(
  parsePlanBlock(`
CLI_DECK_PLAN_ACTUAL_START
task: implement | build the feature
task: review | review the diff
CLI_DECK_PLAN_ACTUAL_END
`),
  [
    { capability: 'implement', title: 'build the feature' },
    { capability: 'review', title: 'review the diff' }
  ]
);
const parsedCommand = parseCommandBlock(`
CLI_DECK_COMMAND_ACTUAL_START
action: dispatch
capability: implement
target: opencode
task: build the worker bridge
CLI_DECK_COMMAND_ACTUAL_END
`);
assert.deepEqual(parsedCommand, {
  action: 'dispatch',
  capability: 'implement',
  task: 'build the worker bridge',
  taskId: '',
  target: 'opencode',
  message: '',
  auto: ''
});
assert.deepEqual(
  consumeOrchestratorBlocks(`
noise
CLI_DECK_COMMAND_ACTUAL_START
action: status
CLI_DECK_COMMAND_ACTUAL_END
CLI_DECK_RESULT_ACTUAL_START
task_id: task-9
status: done
summary: ok
CLI_DECK_RESULT_ACTUAL_END
`).map((event) => event.type),
  ['command', 'result']
);
assert.deepEqual(buildTypedPromptWrites('hello'), ['hello', '\r', '\n']);
assert.deepEqual(buildPastedPromptWrites('hello'), ['\x1b[200~hello\x1b[201~', '\r']);
assert.equal(compactPromptText('hello\n\n world  '), 'hello world');
assert.equal(isMemoryCommandCandidate('npm test'), true);
assert.equal(isMemoryCommandCandidate('[IObjective: hello You are the selected CLI Deck swarm brain.'), false);
assert.equal(isMemoryCommandCandidate('User objective: hello You are the CLI Deck swarm brain.'), false);
assert.equal(isMemoryCommandCandidate('CLI_DECK_COMMAND_ACTUAL_START action: status CLI_DECK_COMMAND_ACTUAL_END'), false);
assert.equal(chooseNextCapability({ status: 'done' }, { capability: 'implement' }), 'review');
assert.equal(chooseNextCapability({ status: 'done' }, { capability: 'review' }), 'test');
assert.equal(chooseNextCapability({ status: 'blocked' }), 'research');
assert.equal(chooseNextCapability({ status: 'needs_test' }), 'test');

const board = { tasks: [], runs: [], nextTaskNumber: 1, nextRunNumber: 1 };
const task = createTestTask(board, 'build dispatcher', 'implement');
assert.equal(task.status, 'ready');
const run = claimTestTask(board, task, { id: 'session-1' });
assert.equal(run.id, 'run-1');
assert.equal(task.status, 'running');
assert.equal(task.attempts, 1);
finishTestTask(board, task, { status: 'blocked', summary: 'missing worker' }, 'blocked');
assert.equal(task.status, 'blocked');
assert.equal(board.runs[0].status, 'blocked');
retryTestTask(task);
assert.equal(task.status, 'ready');
assert.equal(task.currentRunId, null);
const restoredBoard = restoreTestBoard({
  tasks: [{ id: 'task-2', status: 'running', currentRunId: 'run-2' }],
  runs: [{ id: 'run-2', status: 'running' }],
  events: [],
  nextTaskNumber: 3,
  nextRunNumber: 3
});
assert.equal(restoredBoard.tasks[0].status, 'blocked');
assert.equal(restoredBoard.tasks[0].currentRunId, null);
assert.equal(restoredBoard.runs[0].status, 'blocked');
assert.equal(restoredBoard.events[0].kind, 'reclaimed');
assert.equal(inferHeadlessResult('task-3', { exitCode: 0, stdout: 'done' }).status, 'done');
assert.equal(inferHeadlessResult('task-4', { exitCode: 1, stderr: 'failed' }).status, 'blocked');
assert.deepEqual(
  getTestDispatchableTasks([
    { id: 'ready', status: 'ready' },
    { id: 'blocked-worker', status: 'blocked', blockedReason: 'No worker can run implement.' },
    { id: 'blocked-human', status: 'blocked', blockedReason: 'Need product decision.' },
    { id: 'running', status: 'running' }
  ]).map((item) => item.id),
  ['ready', 'blocked-worker']
);

assert.equal(classifyFailureCategory(['npm ERR! command not found']), 'command');
assert.equal(classifyFailureCategory(['Traceback most recent call last']), 'exception');
assert.equal(classifyFailureCategory(['request timed out after 30s']), 'timeout');
assert.equal(classifyFailureCategory(['TLS certificate verify failed']), 'network');

const memories = [
  {
    cwd: 'C:/work/alpha',
    toolUsage: { codex: 2 },
    frequentCommands: [{ command: 'npm test' }],
    knownFailures: [{ text: 'test failed', category: 'build' }],
    recentSummaries: [{ status: 'failed', text: 'npm test failed', failureCategory: 'build' }]
  },
  {
    cwd: 'C:/work/beta',
    toolUsage: { claude: 1 },
    frequentCommands: [{ command: 'npm start' }],
    knownFailures: [],
    recentSummaries: [{ status: 'succeeded', text: 'claude succeeded' }]
  }
];

assert.equal(searchProjectMemories(memories, { query: 'alpha' }).length, 1);
assert.equal(searchProjectMemories(memories, { tool: 'claude' })[0].cwd, 'C:/work/beta');
assert.equal(searchProjectMemories(memories, { status: 'failed' })[0].cwd, 'C:/work/alpha');
assert.equal(searchProjectMemories(memories, { failureCategory: 'build' })[0].cwd, 'C:/work/alpha');
assert.equal(searchProjectMemories(memories, { query: 'missing' }).length, 0);

console.log('smoke-tests-ok');
