const Terminal = window.Terminal;
const FitAddon = window.FitAddon.FitAddon;

const state = {
  presets: [],
  sessions: new Map(),
  activeId: null,
  defaultCwd: '',
  resizeTimer: null,
  memoryRequestId: 0,
  historyRequestId: 0,
  memoryMode: 'history',
  historySearchTimer: null,
  historySearchFocused: false,
  historyFilters: {
    query: '',
    tool: 'all',
    status: 'all',
    failureCategory: 'all'
  },
  historyProjects: [],
  selectedProjectKey: null,
  config: null,
  orchestrator: {
    tasks: [],
    messages: [],
    autoDispatch: true,
    nextTaskNumber: 1,
    brainSessionId: ''
  }
};

const elements = {
  newButton: document.querySelector('#new-session-button'),
  settingsButton: document.querySelector('#settings-button'),
  closeButton: document.querySelector('#close-button'),
  restartButton: document.querySelector('#restart-button'),
  duplicateButton: document.querySelector('#duplicate-button'),
  openCwdButton: document.querySelector('#open-cwd-button'),
  closeStoppedButton: document.querySelector('#close-stopped-button'),
  sessionList: document.querySelector('#session-list'),
  presetList: document.querySelector('#preset-list'),
  terminalStack: document.querySelector('#terminal-stack'),
  emptyState: document.querySelector('#empty-state'),
  workspaceTitle: document.querySelector('#workspace-title'),
  dialog: document.querySelector('#session-dialog'),
  dialogCloseButton: document.querySelector('#dialog-close-button'),
  cancelButton: document.querySelector('#cancel-button'),
  form: document.querySelector('#session-form'),
  nameInput: document.querySelector('#session-name'),
  commandInput: document.querySelector('#session-command'),
  argsInput: document.querySelector('#session-args'),
  cwdInput: document.querySelector('#session-cwd'),
  memoryEnabledInput: document.querySelector('#session-memory-enabled'),
  browseCwdButton: document.querySelector('#browse-cwd-button'),
  memoryCurrentButton: document.querySelector('#memory-current-button'),
  memoryHistoryButton: document.querySelector('#memory-history-button'),
  memoryCard: document.querySelector('#memory-card'),
  orchestratorAutoDispatchInput: document.querySelector('#orchestrator-auto-dispatch'),
  orchestratorBrainSelect: document.querySelector('#orchestrator-brain'),
  orchestratorForm: document.querySelector('#orchestrator-form'),
  orchestratorGoalInput: document.querySelector('#orchestrator-goal'),
  orchestratorQueue: document.querySelector('#orchestrator-queue'),
  orchestratorLog: document.querySelector('#orchestrator-log'),
  settingsDialog: document.querySelector('#settings-dialog'),
  settingsForm: document.querySelector('#settings-form'),
  settingsCloseButton: document.querySelector('#settings-close-button'),
  settingsCancelButton: document.querySelector('#settings-cancel-button'),
  settingsDefaultCwdInput: document.querySelector('#settings-default-cwd'),
  settingsBrowseCwdButton: document.querySelector('#settings-browse-cwd-button'),
  settingsPresetsInput: document.querySelector('#settings-presets'),
  settingsRawLogsInput: document.querySelector('#settings-raw-logs'),
  settingsMaxLogMbInput: document.querySelector('#settings-max-log-mb'),
  settingsRetentionDaysInput: document.querySelector('#settings-retention-days'),
  settingsFailedRetentionDaysInput: document.querySelector('#settings-failed-retention-days')
};

const terminalTheme = {
  background: '#080a0d',
  foreground: '#edf2f7',
  cursor: '#55c2a2',
  selectionBackground: '#2b5c50',
  black: '#101318',
  red: '#e06c75',
  green: '#55c2a2',
  yellow: '#d7ba7d',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d9e2ec'
};

function splitArgs(value) {
  const result = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match;

  while ((match = pattern.exec(value.trim())) !== null) {
    result.push(match[1] ?? match[2] ?? match[0]);
  }

  return result;
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

function computeColumns(count) {
  if (count <= 1) {
    return 1;
  }
  if (count <= 4) {
    return 2;
  }
  return Math.ceil(Math.sqrt(count));
}

function formatDateTime(value) {
  if (!value) {
    return 'Never';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function appendText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  element.textContent = text;
  parent.append(element);
  return element;
}

function appendButton(parent, className, text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
}

function commandLineFromConfig(config) {
  return [config.command, ...(config.args || [])].filter(Boolean).join(' ');
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
  const cwd = config.cwd || state.defaultCwd;
  const baseTitle = stripCwdSuffix(config.name || config.command || 'Terminal') || 'Terminal';
  return `${baseTitle} — ${summarizeCwd(cwd)}`;
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

function presetsToText(presets) {
  return (presets || [])
    .map((preset) => `${preset.name || preset.command} | ${commandLineFromConfig(preset)}`)
    .join('\n');
}

function setStatus(message) {
  elements.workspaceTitle.textContent = message;
}

function updateMemoryTabs() {
  elements.memoryCurrentButton.classList.toggle('active', state.memoryMode === 'current');
  elements.memoryHistoryButton.classList.toggle('active', state.memoryMode === 'history');
}

function renderMemoryEmpty(message) {
  elements.memoryCard.replaceChildren();
  appendText(elements.memoryCard, 'p', 'memory-empty', message);
}

function renderProjectMemory(memory) {
  elements.memoryCard.replaceChildren();

  if (!memory || !memory.cwd) {
    renderMemoryEmpty('Start or select a session to view project memory.');
    return;
  }

  const sessionCount = Number(memory.sessionCount || 0);
  const header = document.createElement('div');
  header.className = 'memory-detail-header';
  appendText(header, 'p', 'memory-path', memory.cwd);
  if (memory.projectKey) {
    appendButton(header, 'tiny-button', 'History', () => {
      state.selectedProjectKey = memory.projectKey;
      state.memoryMode = 'history';
      updateMemoryTabs();
      loadProjectDetail(memory.projectKey);
    });
  }
  elements.memoryCard.append(header);

  const stats = document.createElement('div');
  stats.className = 'memory-stats';
  appendText(stats, 'span', null, `${sessionCount} sessions`);
  appendText(stats, 'span', null, `Last ${formatDateTime(memory.lastSeen)}`);
  elements.memoryCard.append(stats);

  if (sessionCount === 0) {
    appendText(elements.memoryCard, 'p', 'memory-empty', 'No stored memory for this project yet.');
    return;
  }

  const commands = Array.isArray(memory.frequentCommands) ? memory.frequentCommands.slice(0, 3) : [];
  if (commands.length > 0) {
    appendText(elements.memoryCard, 'h3', 'memory-heading', 'Common commands');
    const list = document.createElement('div');
    list.className = 'memory-list';
    for (const item of commands) {
      appendText(list, 'p', 'memory-command', `${item.command} (${item.count})`);
    }
    elements.memoryCard.append(list);
  }

  const summaries = Array.isArray(memory.recentSummaries) ? memory.recentSummaries.slice(0, 3) : [];
  if (summaries.length > 0) {
    appendText(elements.memoryCard, 'h3', 'memory-heading', 'Recent summaries');
    const list = document.createElement('div');
    list.className = 'memory-list';
    for (const summary of summaries) {
      const item = document.createElement('article');
      item.className = `memory-summary memory-${summary.status || 'unknown'}`;
      appendText(item, 'p', 'memory-summary-text', summary.text || 'Session summary unavailable.');
      const logPath = summary.rawLogTruncated ? `${summary.logPath || ''} (truncated)` : summary.logPath || '';
      appendText(item, 'p', 'memory-log-path', logPath);
      if (summary.logPath) {
        const row = document.createElement('div');
        row.className = 'memory-actions';
        appendButton(row, 'tiny-button', 'Open log', () => openPathSafely(summary.logPath));
        item.append(row);
      }
      list.append(item);
    }
    elements.memoryCard.append(list);
  }

  const failures = Array.isArray(memory.knownFailures) ? memory.knownFailures.slice(0, 2) : [];
  if (failures.length > 0) {
    appendText(elements.memoryCard, 'h3', 'memory-heading', 'Known failures');
    const list = document.createElement('div');
    list.className = 'memory-list';
    for (const failure of failures) {
      appendText(list, 'p', 'memory-failure', `[${failure.category || 'general'}] ${failure.text}`);
    }
    elements.memoryCard.append(list);
  }
}

function createMemoryActions(memory) {
  const actions = document.createElement('div');
  actions.className = 'memory-actions';

  appendButton(actions, 'tiny-button', 'Start here', () => {
    openDialog({
      name: pathName(memory.cwd),
      command: state.presets[0]?.command || 'codex',
      args: state.presets[0]?.args || [],
      cwd: memory.cwd
    });
  });
  appendButton(actions, 'tiny-button', 'Open cwd', () => openPathSafely(memory.cwd));
  appendButton(actions, 'tiny-button', 'Export MD', () => exportMemory(memory.projectKey, 'markdown'));
  appendButton(actions, 'tiny-button', 'Export JSON', () => exportMemory(memory.projectKey, 'json'));
  appendButton(actions, 'tiny-button danger-text', 'Delete', () => deleteMemory(memory.projectKey));
  return actions;
}

function pathName(cwd) {
  const parts = String(cwd || '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || 'Session';
}

function renderProjectDetail(memory) {
  elements.memoryCard.replaceChildren();

  if (!memory?.cwd) {
    renderMemoryEmpty('Project memory unavailable.');
    return;
  }

  const top = document.createElement('div');
  top.className = 'memory-detail-top';
  appendButton(top, 'tiny-button', 'Back', () => renderHistoryList(state.historyProjects));
  appendText(top, 'p', 'history-title', 'Project detail');
  elements.memoryCard.append(top);

  appendText(elements.memoryCard, 'p', 'memory-path', memory.cwd);
  elements.memoryCard.append(createMemoryActions(memory));

  const stats = document.createElement('div');
  stats.className = 'memory-stats';
  appendText(stats, 'span', null, `${memory.sessionCount || 0} sessions`);
  appendText(stats, 'span', null, `First ${formatDateTime(memory.firstSeen)}`);
  appendText(stats, 'span', null, `Last ${formatDateTime(memory.lastSeen)}`);
  elements.memoryCard.append(stats);

  const sessions = Array.isArray(memory.recentSessions) ? memory.recentSessions : [];
  if (sessions.length > 0) {
    appendText(elements.memoryCard, 'h3', 'memory-heading', 'Recent sessions');
    const list = document.createElement('div');
    list.className = 'memory-list';
    for (const session of sessions) {
      const item = document.createElement('article');
      item.className = `memory-summary memory-${session.status || 'unknown'}`;
      appendText(item, 'p', 'memory-summary-text', `${session.title || session.commandLine} ${session.status || 'ended'} in ${session.durationText || ''}`);
      appendText(item, 'p', 'memory-command', session.commandLine || '');
      const row = document.createElement('div');
      row.className = 'memory-actions';
      if (session.logPath) {
        appendButton(row, 'tiny-button', 'Open log', () => openPathSafely(session.logPath));
      }
      appendButton(row, 'tiny-button', 'Run again', () => {
        const args = splitArgs(session.commandLine || '');
        const command = args.shift() || '';
        openDialog({
          name: session.title || command,
          command,
          args,
          cwd: memory.cwd
        });
      });
      item.append(row);
      list.append(item);
    }
    elements.memoryCard.append(list);
  }

  const failures = Array.isArray(memory.knownFailures) ? memory.knownFailures : [];
  if (failures.length > 0) {
    appendText(elements.memoryCard, 'h3', 'memory-heading', 'Known failures');
    const list = document.createElement('div');
    list.className = 'memory-list';
    for (const failure of failures) {
      appendText(list, 'p', 'memory-failure', `[${failure.category || 'general'}] ${failure.text}`);
    }
    elements.memoryCard.append(list);
  }
}

function renderHistoryList(projects) {
  elements.memoryCard.replaceChildren();

  const filters = document.createElement('div');
  filters.className = 'history-filters';
  filters.innerHTML = `
    <input class="history-search" type="search" placeholder="Search cwd, command, failure" />
    <div class="history-filter-row">
      <select class="history-tool">
        <option value="all">All tools</option>
        <option value="codex">Codex</option>
        <option value="claude">Claude</option>
        <option value="opencode">OpenCode</option>
        <option value="custom">Custom</option>
      </select>
      <select class="history-status">
        <option value="all">All status</option>
        <option value="succeeded">Succeeded</option>
        <option value="failed">Failed</option>
        <option value="stopped">Stopped</option>
      </select>
      <select class="history-category">
        <option value="all">All failures</option>
        <option value="general">General</option>
        <option value="build">Build</option>
        <option value="command">Command</option>
        <option value="exception">Exception</option>
        <option value="network">Network</option>
        <option value="permission">Permission</option>
        <option value="timeout">Timeout</option>
      </select>
    </div>
  `;
  const search = filters.querySelector('.history-search');
  const tool = filters.querySelector('.history-tool');
  const status = filters.querySelector('.history-status');
  const category = filters.querySelector('.history-category');
  search.value = state.historyFilters.query;
  tool.value = state.historyFilters.tool;
  status.value = state.historyFilters.status;
  category.value = state.historyFilters.failureCategory;
  search.addEventListener('input', () => {
    state.historyFilters.query = search.value;
    state.historySearchFocused = true;
    window.clearTimeout(state.historySearchTimer);
    state.historySearchTimer = window.setTimeout(refreshHistoryPanel, 180);
  });
  tool.addEventListener('change', () => {
    state.historyFilters.tool = tool.value;
    refreshHistoryPanel();
  });
  status.addEventListener('change', () => {
    state.historyFilters.status = status.value;
    refreshHistoryPanel();
  });
  category.addEventListener('change', () => {
    state.historyFilters.failureCategory = category.value;
    refreshHistoryPanel();
  });
  elements.memoryCard.append(filters);
  if (state.historySearchFocused) {
    window.requestAnimationFrame(() => {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    });
  }

  if (!Array.isArray(projects) || projects.length === 0) {
    appendText(elements.memoryCard, 'p', 'memory-empty', 'No historical sessions yet.');
    return;
  }

  const header = document.createElement('div');
  header.className = 'history-header';
  appendText(header, 'p', 'history-title', 'Historical projects');
  const headerRight = document.createElement('div');
  headerRight.className = 'history-header-actions';
  appendText(headerRight, 'p', 'history-subtitle', `${projects.length} matched`);
  appendButton(headerRight, 'tiny-button', 'Cleanup logs', async () => {
    try {
      const result = await window.cliDeck.cleanupRawLogs();
      setStatus(`Cleaned ${result.deletedLogs || 0} raw logs`);
    } catch (error) {
      setStatus(`Cleanup failed: ${error.message}`);
    }
  });
  header.append(headerRight);
  elements.memoryCard.append(header);

  const list = document.createElement('div');
  list.className = 'history-list';

  for (const project of projects) {
    const item = document.createElement('article');
    item.className = 'history-item';
    item.tabIndex = 0;
    item.addEventListener('click', () => loadProjectDetail(project.projectKey));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        loadProjectDetail(project.projectKey);
      }
    });

    const top = document.createElement('div');
    top.className = 'history-item-top';
    appendText(top, 'p', 'history-cwd', project.cwd);
    appendText(top, 'span', 'history-count', `${project.sessionCount || 0}`);
    item.append(top);

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    appendText(meta, 'span', null, formatDateTime(project.lastSeen));
    const tools = Object.entries(project.toolUsage || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([tool, count]) => `${tool} ${count}`)
      .join(' / ');
    if (tools) {
      appendText(meta, 'span', null, tools);
    }
    item.append(meta);

    const commands = Array.isArray(project.frequentCommands) ? project.frequentCommands.slice(0, 2) : [];
    if (commands.length > 0) {
      const commandRow = document.createElement('div');
      commandRow.className = 'history-command-row';
      for (const command of commands) {
        appendText(commandRow, 'span', null, command.command);
      }
      item.append(commandRow);
    }

    const latest = Array.isArray(project.recentSummaries) ? project.recentSummaries[0] : null;
    if (latest) {
      const summary = document.createElement('p');
      summary.className = `history-summary history-${latest.status || 'unknown'}`;
      summary.textContent = latest.text || 'Session summary unavailable.';
      item.append(summary);
    }

    list.append(item);
  }

  elements.memoryCard.append(list);
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

function formatCapabilities(capabilities) {
  return (capabilities || []).join(', ') || 'custom';
}

function addOrchestratorMessage(kind, text, meta = {}) {
  state.orchestrator.messages.unshift({
    id: crypto.randomUUID(),
    kind,
    text,
    meta,
    time: new Date().toLocaleTimeString()
  });
  state.orchestrator.messages = state.orchestrator.messages.slice(0, 80);
  renderOrchestrator();
}

function createSwarmTask(title, capability = 'implement', sourceTaskId = null) {
  return {
    id: `task-${state.orchestrator.nextTaskNumber++}`,
    title: String(title || '').trim(),
    capability,
    sourceTaskId,
    status: 'queued',
    assignedSessionId: null,
    result: null,
    createdAt: Date.now()
  };
}

function writeSubmittedPrompt(sessionId, prompt) {
  const wrapped = `\x1b[200~${prompt}\x1b[201~\r`;
  window.cliDeck.writeTerminal(sessionId, wrapped);
}

function buildBrainPrompt(objective) {
  return [
    '',
    'CLI Deck swarm brain task',
    '',
    'You are the selected swarm brain. Break the objective into executable worker tasks.',
    'Return exactly one plan block using this protocol:',
    '',
    'CLI_DECK_PLAN_START',
    'task: implement | short task for an implement-capable worker',
    'task: review | short task for a review-capable worker',
    'task: test | short task for a test-capable worker',
    'CLI_DECK_PLAN_END',
    '',
    'Objective:',
    objective,
    ''
  ].join('\n');
}

function buildWorkerPrompt(task, session) {
  return [
    '',
    'CLI Deck swarm task',
    '',
    `Task ID: ${task.id}`,
    `Required capability: ${task.capability}`,
    `Your session capabilities: ${formatCapabilities(session.capabilities)}`,
    '',
    'Work on this task. When finished, report exactly one result block using this protocol:',
    '',
    'CLI_DECK_RESULT_START',
    `task_id: ${task.id}`,
    'status: done | blocked | needs_review | needs_test',
    'summary: one sentence summary',
    'details:',
    '- important detail',
    'next:',
    '- suggested next task, or none',
    'CLI_DECK_RESULT_END',
    '',
    'Task:',
    task.title,
    ''
  ].join('\n');
}

function findSessionForCapability(capability) {
  const liveSessions = Array.from(state.sessions.values()).filter((session) => !session.exited);
  return (
    liveSessions.find((session) => session.capabilities.includes(capability)) ||
    liveSessions[0] ||
    null
  );
}

function dispatchTask(taskId) {
  const task = state.orchestrator.tasks.find((item) => item.id === taskId);
  if (!task || task.status === 'running') {
    return;
  }

  const session = findSessionForCapability(task.capability);
  if (!session) {
    addOrchestratorMessage('blocked', `No live CLI session can run ${task.id}. Start a worker session first.`);
    return;
  }

  task.status = 'running';
  task.assignedSessionId = session.id;
  writeSubmittedPrompt(session.id, buildWorkerPrompt(task, session));
  addOrchestratorMessage('dispatch', `${task.id} -> ${session.title}`, { taskId: task.id, sessionId: session.id });
  renderOrchestrator();
}

function dispatchQueuedTasks() {
  if (!state.orchestrator.autoDispatch) {
    return;
  }
  for (const task of state.orchestrator.tasks) {
    if (task.status === 'queued') {
      dispatchTask(task.id);
      return;
    }
  }
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
  if (result.status === 'done' && completedCapability === 'research') {
    return 'implement';
  }
  return '';
}

function enqueueFollowUpFromResult(result, completedTask) {
  const capability = chooseNextCapability(result, completedTask);
  if (!capability || result.next.toLowerCase() === 'none') {
    return;
  }

  const existing = state.orchestrator.tasks.some(
    (task) => task.sourceTaskId === result.taskId && task.capability === capability
  );
  if (existing) {
    return;
  }

  const title =
    capability === 'review'
      ? `Review result of ${result.taskId}: ${result.summary}`
      : capability === 'test'
        ? `Test result of ${result.taskId}: ${result.summary}`
        : `Unblock ${result.taskId}: ${result.next || result.summary}`;
  state.orchestrator.tasks.unshift(createSwarmTask(title, capability, result.taskId));
  addOrchestratorMessage('route', `Queued ${capability} follow-up for ${result.taskId}`);
}

function parseResultBlock(block) {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const result = { taskId: '', status: 'done', summary: '', details: [], next: '' };
  let section = '';

  for (const line of lines) {
    if (line === 'CLI_DECK_RESULT_START' || line === 'CLI_DECK_RESULT_END') {
      continue;
    }
    const match = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (match) {
      section = match[1].toLowerCase();
      const value = match[2].trim();
      if (section === 'task_id') {
        result.taskId = value;
      } else if (section === 'status') {
        result.status = value;
      } else if (section === 'summary') {
        result.summary = value;
      } else if (section === 'next') {
        result.next = value;
      }
      continue;
    }
    if (section === 'details') {
      result.details.push(line.replace(/^-\s*/, ''));
    } else if (section === 'next') {
      result.next = [result.next, line.replace(/^-\s*/, '')].filter(Boolean).join(' | ');
    }
  }

  return result;
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

function consumeResultBlocks(session, data) {
  session.orchestratorBuffer = `${session.orchestratorBuffer || ''}${data}`;
  const events = [];

  let start = session.orchestratorBuffer.indexOf('CLI_DECK_PLAN_START');
  let end = session.orchestratorBuffer.indexOf('CLI_DECK_PLAN_END');
  while (start !== -1 && end !== -1 && end > start) {
    const blockEnd = end + 'CLI_DECK_PLAN_END'.length;
    events.push({ type: 'plan', tasks: parsePlanBlock(session.orchestratorBuffer.slice(start, blockEnd)) });
    session.orchestratorBuffer = session.orchestratorBuffer.slice(blockEnd);
    start = session.orchestratorBuffer.indexOf('CLI_DECK_PLAN_START');
    end = session.orchestratorBuffer.indexOf('CLI_DECK_PLAN_END');
  }

  start = session.orchestratorBuffer.indexOf('CLI_DECK_RESULT_START');
  end = session.orchestratorBuffer.indexOf('CLI_DECK_RESULT_END');

  while (start !== -1 && end !== -1 && end > start) {
    const blockEnd = end + 'CLI_DECK_RESULT_END'.length;
    events.push({ type: 'result', result: parseResultBlock(session.orchestratorBuffer.slice(start, blockEnd)) });
    session.orchestratorBuffer = session.orchestratorBuffer.slice(blockEnd);
    start = session.orchestratorBuffer.indexOf('CLI_DECK_RESULT_START');
    end = session.orchestratorBuffer.indexOf('CLI_DECK_RESULT_END');
  }

  if (session.orchestratorBuffer.length > 12000) {
    session.orchestratorBuffer = session.orchestratorBuffer.slice(-12000);
  }

  return events;
}

function handleBrainPlan(session, plannedTasks) {
  if (!plannedTasks.length) {
    addOrchestratorMessage('blocked', `${session.title} returned an empty plan`);
    return;
  }
  for (const item of plannedTasks.reverse()) {
    state.orchestrator.tasks.unshift(createSwarmTask(item.title, item.capability));
  }
  addOrchestratorMessage('plan', `${session.title} planned ${plannedTasks.length} worker tasks`);
  renderOrchestrator();
  dispatchQueuedTasks();
}

function handleWorkerResult(session, result) {
  const task = state.orchestrator.tasks.find((item) => item.id === result.taskId);
  if (task) {
    task.status = result.status === 'blocked' ? 'blocked' : 'done';
    task.result = result;
  }
  addOrchestratorMessage('result', `${session.title}: ${result.status} ${result.taskId} - ${result.summary || 'No summary'}`, {
    taskId: result.taskId,
    sessionId: session.id
  });
  enqueueFollowUpFromResult(result, task);
  renderOrchestrator();
  dispatchQueuedTasks();
}

function submitSwarmObjective(value) {
  const objective = String(value || '').trim();
  if (!objective) {
    setStatus('Swarm objective is required');
    return;
  }
  elements.orchestratorGoalInput.value = '';

  const brain = state.sessions.get(state.orchestrator.brainSessionId);
  if (brain && !brain.exited) {
    writeSubmittedPrompt(brain.id, buildBrainPrompt(objective));
    addOrchestratorMessage('brain', `Sent objective to brain: ${brain.title}`);
    return;
  }

  const task = createSwarmTask(objective, 'implement');
  state.orchestrator.tasks.unshift(task);
  addOrchestratorMessage('objective', `No brain selected. Queued fallback objective: ${objective}`, { taskId: task.id });
  dispatchQueuedTasks();
}

function renderBrainSelect(workers) {
  const current = state.orchestrator.brainSessionId;
  elements.orchestratorBrainSelect.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'No brain';
  elements.orchestratorBrainSelect.append(empty);

  for (const session of workers) {
    const option = document.createElement('option');
    option.value = session.id;
    option.textContent = session.title;
    elements.orchestratorBrainSelect.append(option);
  }

  if (workers.some((session) => session.id === current)) {
    elements.orchestratorBrainSelect.value = current;
  } else {
    state.orchestrator.brainSessionId = '';
    elements.orchestratorBrainSelect.value = '';
  }
}

function renderOrchestrator() {
  elements.orchestratorQueue.replaceChildren();
  elements.orchestratorLog.replaceChildren();

  const workers = Array.from(state.sessions.values()).filter((session) => !session.exited);
  renderBrainSelect(workers);
  const roster = document.createElement('div');
  roster.className = 'orchestrator-roster';
  if (workers.length === 0) {
    appendText(roster, 'p', 'memory-empty', 'Start CLI sessions to create workers.');
  } else {
    for (const session of workers) {
      const row = document.createElement('div');
      row.className = session.id === state.orchestrator.brainSessionId ? 'orchestrator-worker brain-worker' : 'orchestrator-worker';
      appendText(row, 'span', null, session.title);
      appendText(row, 'span', null, session.id === state.orchestrator.brainSessionId ? 'brain' : formatCapabilities(session.capabilities));
      roster.append(row);
    }
  }
  elements.orchestratorQueue.append(roster);

  const tasks = state.orchestrator.tasks.slice(0, 8);
  if (tasks.length === 0) {
    appendText(elements.orchestratorQueue, 'p', 'memory-empty', 'Enter an objective to dispatch the first task.');
  } else {
    for (const task of tasks) {
      const item = document.createElement('article');
      item.className = `orchestrator-task task-${task.status}`;
      appendText(item, 'p', 'orchestrator-task-title', `${task.id} ${task.title}`);
      appendText(item, 'p', 'orchestrator-task-meta', `${task.status} / ${task.capability}`);
      const actions = document.createElement('div');
      actions.className = 'orchestrator-actions';
      appendButton(actions, 'tiny-button', 'Dispatch', () => dispatchTask(task.id));
      appendButton(actions, 'tiny-button danger-text', 'Drop', () => {
        state.orchestrator.tasks = state.orchestrator.tasks.filter((itemTask) => itemTask.id !== task.id);
        renderOrchestrator();
      });
      item.append(actions);
      elements.orchestratorQueue.append(item);
    }
  }

  for (const message of state.orchestrator.messages.slice(0, 12)) {
    const item = document.createElement('article');
    item.className = `orchestrator-message message-${message.kind}`;
    appendText(item, 'p', 'orchestrator-message-text', message.text);
    appendText(item, 'p', 'orchestrator-message-meta', `${message.kind} / ${message.time}`);
    elements.orchestratorLog.append(item);
  }
}

async function refreshHistoryPanel() {
  state.selectedProjectKey = null;
  const requestId = ++state.historyRequestId;
  renderMemoryEmpty('Loading history...');

  try {
    const projects = await window.cliDeck.searchProjectMemories({
      ...state.historyFilters,
      limit: 100
    });
    if (requestId === state.historyRequestId && state.memoryMode === 'history') {
      state.historyProjects = projects;
      renderHistoryList(projects);
    }
  } catch (error) {
    if (requestId === state.historyRequestId && state.memoryMode === 'history') {
      renderMemoryEmpty(`History unavailable: ${error.message}`);
    }
  }
}

async function loadProjectDetail(projectKey) {
  if (!projectKey) {
    return;
  }
  state.selectedProjectKey = projectKey;
  state.historyRequestId += 1;
  renderMemoryEmpty('Loading project detail...');
  try {
    const memory = await window.cliDeck.getProjectMemoryByKey(projectKey);
    renderProjectDetail(memory);
  } catch (error) {
    renderMemoryEmpty(`Project unavailable: ${error.message}`);
  }
}

async function openPathSafely(targetPath) {
  if (!targetPath) {
    return;
  }
  try {
    await window.cliDeck.openPath(targetPath);
  } catch (error) {
    setStatus(`Open failed: ${error.message}`);
  }
}

async function exportMemory(projectKey, format) {
  try {
    const result = await window.cliDeck.exportProjectMemory(projectKey, format);
    setStatus(`Exported ${result.filePath}`);
    await openPathSafely(result.filePath);
  } catch (error) {
    setStatus(`Export failed: ${error.message}`);
  }
}

async function deleteMemory(projectKey) {
  if (!projectKey || !window.confirm('Delete this project memory? Raw session files are kept.')) {
    return;
  }
  try {
    await window.cliDeck.deleteProjectMemory(projectKey, false);
    state.selectedProjectKey = null;
    await refreshHistoryPanel();
  } catch (error) {
    setStatus(`Delete failed: ${error.message}`);
  }
}

async function refreshMemoryPanel() {
  const requestId = ++state.memoryRequestId;
  const active = state.sessions.get(state.activeId);

  if (!active?.cwd) {
    renderMemoryEmpty('Start or select a session to view project memory.');
    return;
  }

  renderMemoryEmpty('Loading project memory...');

  try {
    const memory = await window.cliDeck.getProjectMemory(active.cwd);
    if (requestId === state.memoryRequestId) {
      renderProjectMemory(memory);
    }
  } catch (error) {
    if (requestId === state.memoryRequestId) {
      renderMemoryEmpty(`Memory unavailable: ${error.message}`);
    }
  }
}

function setMemoryMode(mode) {
  state.memoryMode = mode;
  updateMemoryTabs();

  if (mode === 'history') {
    refreshHistoryPanel();
    return;
  }

  refreshMemoryPanel();
}

function setActiveSession(id) {
  state.activeId = id;

  for (const [sessionId, session] of state.sessions) {
    const isActive = sessionId === id;
    session.tile.classList.toggle('active', isActive);
    session.listItem.classList.toggle('active', isActive);

    if (isActive) {
      session.fit.fit();
      window.cliDeck.resizeTerminal(sessionId, session.term.cols, session.term.rows);
      session.term.focus();
    }
  }

  const active = state.sessions.get(id);
  const count = state.sessions.size;
  elements.emptyState.classList.toggle('hidden', count > 0);
  elements.workspaceTitle.textContent = active ? active.title : count === 0 ? 'No sessions' : `${count} sessions`;
  updateToolbarState();
  syncLayout();
  if (!active && state.memoryMode === 'current') {
    setMemoryMode('history');
    return;
  }
  if (state.memoryMode === 'current') {
    refreshMemoryPanel();
  }
  renderOrchestrator();
}

function updateToolbarState() {
  const active = state.sessions.get(state.activeId);
  elements.closeButton.disabled = !active || active.exited;
  elements.restartButton.disabled = !active;
  elements.duplicateButton.disabled = !active;
  elements.openCwdButton.disabled = !active?.cwd;
  elements.closeStoppedButton.disabled = !Array.from(state.sessions.values()).some((session) => session.exited);
}

function syncLayout() {
  const count = state.sessions.size;
  elements.terminalStack.style.setProperty('--tile-columns', String(computeColumns(count)));
  elements.emptyState.classList.toggle('hidden', count > 0);

  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(() => {
    for (const session of state.sessions.values()) {
      session.fit.fit();
      window.cliDeck.resizeTerminal(session.id, session.term.cols, session.term.rows);
    }
  }, 60);
}

function renderPresets() {
  elements.presetList.replaceChildren();

  for (const preset of state.presets) {
    const item = document.createElement('button');
    item.className = `preset-item preset-${classifyCommand(preset.command)}`;
    item.type = 'button';
    item.innerHTML = `
      <span>
        <span class="preset-name"></span>
        <span class="preset-command"></span>
      </span>
      <span aria-hidden="true">+</span>
    `;
    item.querySelector('.preset-name').textContent = preset.name;
    item.querySelector('.preset-command').textContent = [preset.command, ...(preset.args || [])].join(' ');
    item.addEventListener('click', () => startSession(preset));
    elements.presetList.append(item);
  }
}

function updateSessionListItem(session) {
  session.listItem.querySelector('.session-name').textContent = session.title;
  session.listItem.querySelector('.session-command').textContent = commandLineFromConfig(session);
  const memoryLabel = session.listItem.querySelector('.session-memory');
  const memoryText = session.memoryEnabled === false ? 'Memory off' : 'Memory on';
  memoryLabel.textContent = `${formatCapabilities(session.capabilities)} / ${memoryText}`;
  memoryLabel.hidden = false;
}

function createSessionListItem(session) {
  const item = document.createElement('button');
  item.className = 'session-item';
  item.type = 'button';
  item.innerHTML = `
    <span>
      <span class="session-name"></span>
      <span class="session-command"></span>
      <span class="session-memory"></span>
    </span>
    <span class="status-dot" aria-hidden="true"></span>
  `;
  item.addEventListener('click', () => {
    setActiveSession(session.id);
    setMemoryMode('current');
  });
  elements.sessionList.append(item);
  session.listItem = item;
  updateSessionListItem(session);
  return item;
}

function createTile(session) {
  const tile = document.createElement('section');
  tile.dataset.sessionId = session.id;
  tile.className = `terminal-pane terminal-${classifyCommand(session.command)}`;
  tile.innerHTML = `
    <header class="tile-header">
      <span class="tile-title"></span>
      <span class="tile-header-actions">
        <span class="tile-memory"></span>
        <button class="tile-button tile-rename" type="button">Rename</button>
        <button class="tile-button tile-copy" type="button">Copy</button>
        <span class="tile-kind">RUNNING</span>
      </span>
    </header>
    <div class="tile-body"></div>
  `;
  tile.querySelector('.tile-title').textContent = session.title;
  const memoryBadge = tile.querySelector('.tile-memory');
  memoryBadge.textContent = session.memoryEnabled === false ? 'MEMORY OFF' : '';
  memoryBadge.hidden = session.memoryEnabled !== false;
  tile.querySelector('.tile-rename').addEventListener('click', (event) => {
    event.stopPropagation();
    renameSession(tile.dataset.sessionId);
  });
  tile.querySelector('.tile-copy').addEventListener('click', (event) => {
    event.stopPropagation();
    copySessionCommand(tile.dataset.sessionId);
  });
  tile.addEventListener('pointerdown', () => {
    setActiveSession(tile.dataset.sessionId);
    setMemoryMode('current');
  });
  elements.terminalStack.append(tile);
  return {
    tile,
    body: tile.querySelector('.tile-body')
  };
}

function createTerminal() {
  const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    scrollback: 10000,
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.18,
    theme: terminalTheme
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  return { term, fit };
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

function writePastedText(session, text) {
  if (!session || session.exited || !text) {
    return false;
  }
  window.cliDeck.writeTerminal(session.id, text);
  session.term.focus();
  return true;
}

async function pasteClipboardText(session) {
  try {
    const text = await window.cliDeck.readClipboardText();
    writePastedText(session, text);
  } catch (error) {
    setStatus(`Paste failed: ${error.message}`);
  }
}

async function copyText(value, status = 'Copied') {
  try {
    await window.cliDeck.writeClipboardText(value);
    setStatus(status);
    return true;
  } catch {
    setStatus(value);
    return false;
  }
}

async function copyTerminalSelection(session) {
  const selection = session.term.getSelection();
  if (!selection) {
    return false;
  }

  const copied = await copyText(selection, 'Copied selection');
  if (copied) {
    session.term.clearSelection();
    session.term.focus();
  }
  return copied;
}

function attachTextPasteHandlers(session) {
  session.term.attachCustomKeyEventHandler((event) => {
    if (event.type === 'keydown' && isTextPasteShortcut(event)) {
      event.preventDefault();
      pasteClipboardText(session);
      return false;
    }
    return true;
  });

  session.body.addEventListener('paste', (event) => {
    const text =
      event.clipboardData?.getData('text/plain') ||
      event.clipboardData?.getData('text') ||
      '';

    if (writePastedText(session, text)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  session.body.addEventListener('contextmenu', (event) => {
    if (!session.term.hasSelection()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    copyTerminalSelection(session);
  });
}

async function startSession(config) {
  const { term, fit } = createTerminal();
  const launchConfig = {
    ...config,
    cwd: config.cwd || state.defaultCwd
  };
  const pendingSession = {
    id: `pending-${crypto.randomUUID()}`,
    title: buildSessionTitle(launchConfig),
    command: launchConfig.command,
    args: launchConfig.args || [],
    memoryEnabled: launchConfig.memoryEnabled !== false,
    term,
    fit
  };
  const { tile, body } = createTile(pendingSession);

  term.open(body);
  fit.fit();
  term.writeln(`Starting ${pendingSession.title}...`);

  let created;
  try {
    created = await window.cliDeck.createTerminal({
      ...launchConfig,
      cols: term.cols,
      rows: term.rows
    });
  } catch (error) {
    term.writeln('');
    term.writeln(`Failed to start "${config.command}": ${error.message}`);
    window.setTimeout(() => {
      term.dispose();
      tile.remove();
      syncLayout();
    }, 4000);
    return;
  }

  const session = {
    ...created,
    term,
    fit,
    tile,
    body,
    listItem: null,
    sourceConfig: launchConfig,
    exited: false,
    capabilities: inferCapabilities(created.command),
    orchestratorBuffer: ''
  };
  tile.dataset.sessionId = session.id;
  tile.querySelector('.tile-title').textContent = session.title;
  createSessionListItem(session);
  state.sessions.set(session.id, session);

  term.clear();
  attachTextPasteHandlers(session);
  term.onData((data) => window.cliDeck.writeTerminal(session.id, data));
  setActiveSession(session.id);
  setMemoryMode('current');
  renderOrchestrator();
  syncLayout();
}

function openDialog(config = {}) {
  elements.nameInput.value = config.name || '';
  elements.commandInput.value = config.command || '';
  elements.argsInput.value = (config.args || []).join(' ');
  elements.cwdInput.value = config.cwd || state.defaultCwd;
  elements.memoryEnabledInput.checked = config.memoryEnabled !== false;
  elements.dialog.showModal();
  window.setTimeout(() => elements.commandInput.focus(), 0);
}

function openSettingsDialog() {
  const config = state.config || {};
  const memory = config.memory || {};
  elements.settingsDefaultCwdInput.value = config.defaultCwd || state.defaultCwd;
  elements.settingsPresetsInput.value = presetsToText(state.presets);
  elements.settingsRawLogsInput.checked = memory.rawLogsEnabled !== false;
  elements.settingsMaxLogMbInput.value = Math.max(1, Math.round(Number(memory.maxLogBytes || 0) / 1024 / 1024)) || 20;
  elements.settingsRetentionDaysInput.value = memory.rawLogRetentionDays || 30;
  elements.settingsFailedRetentionDaysInput.value = memory.failedRawLogRetentionDays || 60;
  elements.settingsDialog.showModal();
}

async function saveSettings() {
  const maxLogMb = Number(elements.settingsMaxLogMbInput.value) || 20;
  const nextConfig = {
    defaultCwd: elements.settingsDefaultCwdInput.value.trim() || state.defaultCwd,
    presets: parsePresetsText(elements.settingsPresetsInput.value),
    memory: {
      rawLogsEnabled: elements.settingsRawLogsInput.checked,
      maxLogBytes: maxLogMb * 1024 * 1024,
      rawLogRetentionDays: Number(elements.settingsRetentionDaysInput.value) || 30,
      failedRawLogRetentionDays: Number(elements.settingsFailedRetentionDaysInput.value) || 60
    }
  };
  const saved = await window.cliDeck.saveConfig(nextConfig);
  applyConfig(saved);
  elements.settingsDialog.close();
  setStatus('Settings saved');
}

function applyConfig(config) {
  state.config = config;
  state.presets = config.presets || [];
  state.defaultCwd = config.defaultCwd || '';
  elements.cwdInput.value = state.defaultCwd;
  renderPresets();
  renderOrchestrator();
}

function removeSession(id) {
  const session = state.sessions.get(id);
  if (!session) {
    return;
  }

  session.term.dispose();
  session.tile.remove();
  session.listItem.remove();
  state.sessions.delete(id);

  if (state.activeId === id) {
    const nextId = state.sessions.keys().next().value || null;
    setActiveSession(nextId);
  }
  syncLayout();
}

function closeActiveSession() {
  const active = state.sessions.get(state.activeId);
  if (!active) {
    return;
  }

  window.cliDeck.closeTerminal(active.id);
  removeSession(active.id);
}

function duplicateActiveSession() {
  const active = state.sessions.get(state.activeId);
  if (!active) {
    return;
  }
  startSession({
    ...active.sourceConfig,
    name: `${stripCwdSuffix(active.title)} copy`
  });
}

function closeStoppedSessions() {
  for (const session of Array.from(state.sessions.values())) {
    if (session.exited) {
      removeSession(session.id);
    }
  }
  updateToolbarState();
}

function openActiveCwd() {
  const active = state.sessions.get(state.activeId);
  if (active?.cwd) {
    openPathSafely(active.cwd);
  }
}

function copySessionCommand(id) {
  const session = state.sessions.get(id);
  if (session) {
    copyText(commandLineFromConfig(session), 'Copied command');
  }
}

function renameSession(id) {
  const session = state.sessions.get(id);
  if (!session) {
    return;
  }
  const nextTitle = window.prompt('Session name', session.title);
  if (!nextTitle || !nextTitle.trim()) {
    return;
  }
  session.title = nextTitle.trim();
  session.sourceConfig = { ...session.sourceConfig, name: stripCwdSuffix(session.title) };
  session.tile.querySelector('.tile-title').textContent = session.title;
  updateSessionListItem(session);
  if (state.activeId === id) {
    elements.workspaceTitle.textContent = session.title;
  }
}

function markExited(id, exitCode) {
  const session = state.sessions.get(id);
  if (!session) {
    return;
  }

  session.exited = true;
  session.tile.querySelector('.tile-kind').textContent = 'EXITED';
  session.listItem.querySelector('.status-dot').classList.add('exited');
  session.term.writeln('');
  session.term.writeln(`[process exited with code ${exitCode}]`);

  if (state.activeId === id) {
    elements.closeButton.disabled = true;
  }
  elements.closeStoppedButton.disabled = false;
}

function restartActiveSession() {
  const active = state.sessions.get(state.activeId);
  if (!active) {
    return;
  }

  const config = active.sourceConfig;
  removeSession(active.id);
  startSession(config);
}

elements.newButton.addEventListener('click', () => openDialog());
elements.settingsButton.addEventListener('click', openSettingsDialog);
elements.closeButton.addEventListener('click', closeActiveSession);
elements.restartButton.addEventListener('click', restartActiveSession);
elements.duplicateButton.addEventListener('click', duplicateActiveSession);
elements.openCwdButton.addEventListener('click', openActiveCwd);
elements.closeStoppedButton.addEventListener('click', closeStoppedSessions);
elements.memoryCurrentButton.addEventListener('click', () => setMemoryMode('current'));
elements.memoryHistoryButton.addEventListener('click', () => setMemoryMode('history'));
elements.dialogCloseButton.addEventListener('click', () => elements.dialog.close());
elements.cancelButton.addEventListener('click', () => elements.dialog.close());
elements.settingsCloseButton.addEventListener('click', () => elements.settingsDialog.close());
elements.settingsCancelButton.addEventListener('click', () => elements.settingsDialog.close());
elements.orchestratorAutoDispatchInput.addEventListener('change', () => {
  state.orchestrator.autoDispatch = elements.orchestratorAutoDispatchInput.checked;
  addOrchestratorMessage('config', `Auto dispatch ${state.orchestrator.autoDispatch ? 'enabled' : 'disabled'}`);
  dispatchQueuedTasks();
});
elements.orchestratorBrainSelect.addEventListener('change', () => {
  state.orchestrator.brainSessionId = elements.orchestratorBrainSelect.value;
  const brain = state.sessions.get(state.orchestrator.brainSessionId);
  addOrchestratorMessage('config', brain ? `Brain selected: ${brain.title}` : 'Brain cleared');
});
elements.browseCwdButton.addEventListener('click', async () => {
  const selectedPath = await window.cliDeck.selectDirectory();
  if (selectedPath) {
    elements.cwdInput.value = selectedPath;
  }
});
elements.settingsBrowseCwdButton.addEventListener('click', async () => {
  const selectedPath = await window.cliDeck.selectDirectory();
  if (selectedPath) {
    elements.settingsDefaultCwdInput.value = selectedPath;
  }
});

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const command = elements.commandInput.value.trim();
  if (!command) {
    return;
  }

  elements.dialog.close();
  startSession({
    name: elements.nameInput.value.trim() || command,
    command,
    args: splitArgs(elements.argsInput.value),
    cwd: elements.cwdInput.value.trim() || state.defaultCwd,
    memoryEnabled: elements.memoryEnabledInput.checked
  });
});

elements.settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveSettings().catch((error) => {
    setStatus(`Settings failed: ${error.message}`);
  });
});

elements.orchestratorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitSwarmObjective(elements.orchestratorGoalInput.value);
});

window.addEventListener('resize', () => {
  window.requestAnimationFrame(syncLayout);
});

window.cliDeck.onTerminalData(({ id, data }) => {
  const session = state.sessions.get(id);
  if (session) {
    session.term.write(data);
    for (const event of consumeResultBlocks(session, data)) {
      if (event.type === 'plan') {
        handleBrainPlan(session, event.tasks);
      } else if (event.type === 'result') {
        handleWorkerResult(session, event.result);
      }
    }
  }
});

window.cliDeck.onTerminalExit(({ id, exitCode }) => {
  markExited(id, exitCode);
});

window.cliDeck.onMemoryUpdated(({ cwd, memory }) => {
  const active = state.sessions.get(state.activeId);
  if (state.memoryMode === 'current' && active?.cwd === cwd) {
    renderProjectMemory(memory);
    return;
  }
  if (state.memoryMode === 'history') {
    refreshHistoryPanel();
  }
});

window.cliDeck.getConfig().then((config) => {
  applyConfig(config);
  setMemoryMode('history');
});
