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

function sanitizeGoalTask(task = {}) {
  return {
    id: String(task.id || 'task-id'),
    title: String(task.title || '').trim(),
    status: ['todo', 'doing', 'blocked', 'done'].includes(task.status) ? task.status : 'todo',
    notes: String(task.notes || '').trim(),
    sessionIds: Array.isArray(task.sessionIds) ? [...new Set(task.sessionIds.map(String))] : []
  };
}

function nextGoalTaskStatus(value) {
  const order = ['todo', 'doing', 'done'];
  const index = order.indexOf(value);
  if (value === 'blocked') {
    return 'doing';
  }
  return order[(index + 1) % order.length] || 'todo';
}

function goalToMarkdown(goal) {
  const lines = [
    `# ${goal.title || 'CLI Deck goal'}`,
    '',
    `Project: \`${goal.cwd}\``,
    `Status: ${goal.status || 'active'}`,
    '',
    '## Tasks'
  ];

  if (!goal.tasks.length) {
    lines.push('- None');
  } else {
    for (const task of goal.tasks) {
      lines.push(`- [${task.status === 'done' ? 'x' : ' '}] ${task.title} (${task.status})`);
    }
  }

  return `${lines.join('\n')}\n`;
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
assert.deepEqual(sanitizeGoalTask({ title: '  Ship goal panel  ', status: 'bad', sessionIds: ['a', 'a'] }), {
  id: 'task-id',
  title: 'Ship goal panel',
  status: 'todo',
  notes: '',
  sessionIds: ['a']
});
assert.equal(nextGoalTaskStatus('todo'), 'doing');
assert.equal(nextGoalTaskStatus('doing'), 'done');
assert.equal(nextGoalTaskStatus('done'), 'todo');
assert.equal(nextGoalTaskStatus('blocked'), 'doing');
assert.match(
  goalToMarkdown({
    title: 'Goal records',
    cwd: 'C:/development/workspace/tools',
    status: 'active',
    tasks: [{ title: 'Build MVP', status: 'done' }]
  }),
  /- \[x\] Build MVP \(done\)/
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
