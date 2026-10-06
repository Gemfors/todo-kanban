'use strict';

/*
 * Todo Kanban – renderer
 *
 * All data lives in one `state` object. Every change goes through commit(),
 * which saves and re-renders the whole UI from that state. Tasks point to
 * their project by id, so renaming a project never disconnects its tasks.
 */

const DEFAULT_COLOR = '#4f46e5';
const BOARD_COLUMNS = ['todo', 'doing', 'done'];
const ALL_COLUMNS = ['pool', ...BOARD_COLUMNS];
const COLUMN_LABELS = { pool: 'Task Pool', todo: 'To Do', doing: 'Doing', done: 'Done' };
const NEXT_STEP = { pool: 'todo', todo: 'doing', doing: 'done', done: 'pool' };
const PREVIOUS_STEP = { todo: 'pool', doing: 'todo', done: 'doing' };
const MAX_UNDO = 50;
const CLICK_DELAY_MS = 220;
const FALLBACK_STORAGE_KEY = 'kanban-data-v2';
const WAITING_STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const storage = window.kanbanStorage || null;

let state = emptyState();
let undoStack = [];
let redoStack = [];
let lastProjectId = null;

let draggedTaskId = null;
let draggedProjectSection = null;
let lastDragEndAt = 0;
let pendingClickTimer = null;
let currentModal = null;
let saveFailed = false;
let savingBlocked = false; // set if the data file could not be read, so we never overwrite it

const projectsRow = document.querySelector('.projects-row');
const newProjectInput = document.querySelector('#new-project-input');
const addProjectButton = document.querySelector('#add-project-button');
const clearDoneButton = document.querySelector('#clear-done-button');
const archiveButton = document.querySelector('#archive-button');
const shortcutsButton = document.querySelector('#shortcuts-button');
const toastEl = document.querySelector('#toast');
const toastMessage = toastEl.querySelector('.toast-message');
const toastUndo = toastEl.querySelector('.toast-undo');

const boardColumns = {};
document.querySelectorAll('.column[data-column]').forEach(column => {
  boardColumns[column.dataset.column] = {
    zone: column,
    list: column.querySelector('.card-list'),
    count: column.querySelector('.column-count')
  };
});

/* ================= Helpers ================= */

function defaultSettings() {
  return { autoClearDone: true };
}

function emptyState() {
  return { version: 2, projects: [], tasks: [], archive: [], settings: defaultSettings() };
}

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function isColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function getProject(id) {
  return state.projects.find(project => project.id === id) || null;
}

function getTask(id) {
  return state.tasks.find(task => task.id === id) || null;
}

function projectColor(id) {
  const project = getProject(id);
  return (project && project.color) || DEFAULT_COLOR;
}

/* ---------- Project short labels ---------- */

const MAX_LABEL_LENGTH = 5;

function cleanShortLabel(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').slice(0, MAX_LABEL_LENGTH);
}

// Automatic label from the name: initials for several words (Large Accounts Management → LAM),
// a leading acronym as is (AHK & Macros → AHK), otherwise the first three letters (Övrigt → ÖVR).
function autoShortLabel(name) {
  const words = String(name || '').split(/[\s/&_,.+\-]+/).filter(Boolean);
  if (words.length === 0) return '?';

  const isAcronym = word => word.length >= 2 && word.length <= MAX_LABEL_LENGTH && word === word.toLocaleUpperCase('sv') && /\p{L}/u.test(word);
  if (isAcronym(words[0])) return words[0];
  if (words.length === 1) return words[0].slice(0, 3).toLocaleUpperCase('sv');

  return words.slice(0, 4).map(word => word[0]).join('').toLocaleUpperCase('sv');
}

// Labels for all projects; automatic labels that would collide get an extra letter or a number.
function projectLabels() {
  const labels = new Map();
  const used = new Set();

  state.projects.filter(p => cleanShortLabel(p.shortLabel)).forEach(project => {
    const label = cleanShortLabel(project.shortLabel);
    labels.set(project.id, label);
    used.add(label.toLocaleUpperCase('sv'));
  });

  state.projects.filter(p => !labels.has(p.id)).forEach(project => {
    const base = autoShortLabel(project.name);
    const letters = String(project.name).replace(/[^\p{L}\p{N}]/gu, '').toLocaleUpperCase('sv');
    const words = String(project.name).split(/[\s/&_,.+\-]+/).filter(Boolean);
    // e.g. Sales Enablement next to Sales Excellence (SE) → SEN
    const longerInitials = words.length > 1
      ? (words.slice(0, -1).map(w => w[0]).join('') + words[words.length - 1].slice(0, 2)).toLocaleUpperCase('sv')
      : '';
    const candidates = [base, longerInitials, letters.slice(0, 3), letters.slice(0, 4)];
    let label = candidates.find(c => c && !used.has(c.toLocaleUpperCase('sv')));
    for (let n = 2; !label; n++) {
      const numbered = `${base.slice(0, MAX_LABEL_LENGTH - 1)}${n}`;
      if (!used.has(numbered)) label = numbered;
    }
    labels.set(project.id, label);
    used.add(label.toLocaleUpperCase('sv'));
  });

  return labels;
}

function projectLabel(projectId) {
  return projectLabels().get(projectId) || '?';
}

// Dark or white text, whichever reads better on the project colour.
function readableTextColor(hex) {
  const value = isColor(hex) ? hex : DEFAULT_COLOR;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#1f2933' : '#ffffff';
}

function paintProjectTag(tag, color) {
  tag.style.background = color;
  tag.style.color = readableTextColor(color);
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Local calendar day, e.g. "2026-10-06" (not UTC, so midnight is your midnight).
function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysSince(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY_MS));
}

function normalizeWaiting(value) {
  if (!value || typeof value !== 'object') return null;
  const since = value.since && !Number.isNaN(new Date(value.since).getTime()) ? String(value.since) : nowIso();
  return { who: String(value.who || '').replace(/\s+/g, ' ').trim().slice(0, 80), since };
}

function waitingDaysLabel(days) {
  if (days === 0) return 'today';
  return `${days}d`;
}

function waitingTitle(waiting) {
  const days = daysSince(waiting.since);
  const who = waiting.who ? `Waiting for ${waiting.who}` : 'Waiting';
  return `${who} since ${formatDate(waiting.since)} (${days === 1 ? '1 day' : `${days} days`}). Press W to clear.`;
}

// Guesses who you're waiting on from the task text, e.g. "Följ upp med Niklas …" → "Niklas",
// "Fredriks ask kring VCC" → "Fredrik". Only used to prefill the name.
function suggestWaitingName(text) {
  const value = String(text || '');
  const name = '(\\p{Lu}[\\p{L}\\-]+)';
  // Keywords match with or without a capital first letter ("med"/"Med").
  const words = list => `(?:${list.split('|').map(w => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`).join('|')})`;
  const patterns = [
    new RegExp(`(?:^|\\s)${words('med|från|with|from|för|av')}\\s+${name}`, 'u'),
    new RegExp(`${name}s\\s+${words('ask|fråga|input|svar|feedback|godkännande|ok')}(?!\\p{L})`, 'u'),
    new RegExp(`(?:^|\\s)${words('fråga|ask|ping|påminn|remind|mejla|maila|ring|call')}\\s+${name}`, 'u')
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match) return match[1];
  }
  return '';
}

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isTypingTarget(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'textarea' || tag === 'select' || target.isContentEditable ||
    (tag === 'input' && !['button', 'checkbox', 'radio', 'color'].includes(target.type));
}

/* ================= Data: load, migrate, save ================= */

// Accepts the current format, an imported backup, or the old localStorage format
// (projects by name, tasks with a `project` name) and returns clean v2 data.
function normalizeData(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const data = emptyState();
  const projectIds = new Set();
  const projectsByName = new Map();
  const usedTaskIds = new Set();

  function addProject(name, extra = {}) {
    const cleanName = String(name || '').trim() || 'Untitled';
    const id = extra.id && !projectIds.has(String(extra.id)) ? String(extra.id) : uid();
    const project = {
      id,
      name: cleanName,
      color: isColor(extra.color) ? extra.color : DEFAULT_COLOR,
      collapsed: Boolean(extra.collapsed),
      shortLabel: cleanShortLabel(extra.shortLabel)
    };
    data.projects.push(project);
    projectIds.add(id);
    if (!projectsByName.has(cleanName)) projectsByName.set(cleanName, project);
    return project;
  }

  (Array.isArray(raw.projects) ? raw.projects : []).forEach(project => {
    if (project && typeof project === 'object') addProject(project.name, project);
  });

  function resolveProjectId(task) {
    if (task.projectId && projectIds.has(String(task.projectId))) return String(task.projectId);

    const name = typeof task.project === 'string' ? task.project.trim() : '';
    if (name) return (projectsByName.get(name) || addProject(name)).id;

    return (data.projects[0] || addProject('Work')).id;
  }

  function taskId(task) {
    const id = task.id && !usedTaskIds.has(String(task.id)) ? String(task.id) : uid();
    usedTaskIds.add(id);
    return id;
  }

  (Array.isArray(raw.tasks) ? raw.tasks : []).forEach(task => {
    if (!task || typeof task !== 'object') return;
    const text = String(task.text ?? '').trim();
    if (!text) return;

    data.tasks.push({
      id: taskId(task),
      text,
      notes: typeof task.notes === 'string' ? task.notes : '',
      projectId: resolveProjectId(task),
      column: ALL_COLUMNS.includes(task.column) ? task.column : 'pool',
      waitingFor: task.column === 'done' ? null : normalizeWaiting(task.waitingFor),
      // When it was finished. Older data has no doneAt: use the last change as the best guess.
      doneAt: task.column === 'done' ? validIso(task.doneAt) || validIso(task.updatedAt) || nowIso() : null,
      createdAt: task.createdAt || nowIso(),
      updatedAt: task.updatedAt || task.createdAt || nowIso()
    });
  });

  (Array.isArray(raw.archive) ? raw.archive : []).forEach(task => {
    if (!task || typeof task !== 'object') return;
    const text = String(task.text ?? '').trim();
    if (!text) return;

    data.archive.push({
      id: taskId(task),
      text,
      notes: typeof task.notes === 'string' ? task.notes : '',
      projectId: task.projectId ? String(task.projectId) : '',
      projectName: typeof task.projectName === 'string' ? task.projectName : '',
      createdAt: task.createdAt || nowIso(),
      doneAt: validIso(task.doneAt) || validIso(task.archivedAt) || nowIso(),
      archivedAt: task.archivedAt || nowIso()
    });
  });

  if (data.projects.length === 0) addProject('Work');

  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  data.settings = { ...defaultSettings(), ...(typeof settings.autoClearDone === 'boolean' ? { autoClearDone: settings.autoClearDone } : {}) };

  return data;
}

function validIso(value) {
  return value && !Number.isNaN(new Date(value).getTime()) ? String(value) : null;
}

function readLegacyLocalStorage() {
  try {
    const tasks = localStorage.getItem('tasks');
    const projects = localStorage.getItem('projects');
    if (!tasks && !projects) return null;
    return {
      tasks: tasks ? JSON.parse(tasks) : [],
      projects: projects ? JSON.parse(projects) : []
    };
  } catch (err) {
    console.error('Could not read old localStorage data', err);
    return null;
  }
}

function defaultData() {
  return normalizeData({
    projects: [
      { name: 'Work', color: DEFAULT_COLOR },
      { name: 'Presentations', color: '#0ea5e9' }
    ],
    tasks: [
      { text: 'Fix login bug', column: 'pool', project: 'Work' },
      { text: 'Write project proposal', column: 'pool', project: 'Work' },
      { text: 'Prepare slides', column: 'pool', project: 'Presentations' }
    ]
  });
}

async function loadRawData() {
  if (storage) return storage.load();
  const saved = localStorage.getItem(FALLBACK_STORAGE_KEY);
  return saved ? JSON.parse(saved) : null;
}

function save() {
  if (savingBlocked) return;
  const data = clone(state);

  if (!storage) {
    try {
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      reportSaveError(err);
    }
    return;
  }

  storage.save(data).then(() => {
    if (saveFailed) {
      saveFailed = false;
      showToast('Saved again — all good.');
    }
  }).catch(reportSaveError);
}

function reportSaveError(err) {
  saveFailed = true;
  console.error('Save failed', err);
  showToast(`Could not save your changes: ${err && err.message ? err.message : err}`, { sticky: true });
}

/* ================= Commit / undo ================= */

function commit(mutate, { undoable = true, toast = null } = {}) {
  const before = clone(state);
  const result = mutate();
  if (result === false) return;

  if (undoable) {
    undoStack.push(before);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }

  save();
  render();

  if (toast) {
    showToast(toast, { undo: undoable });
  } else if (undoable) {
    hideToast();
  }
}

// Collapsing a project is a view setting, so undo/redo keeps the current collapse state.
function keepCurrentCollapse(snapshot) {
  const collapsed = new Map(state.projects.map(project => [project.id, project.collapsed]));
  snapshot.projects.forEach(project => {
    if (collapsed.has(project.id)) project.collapsed = collapsed.get(project.id);
  });
  return snapshot;
}

function undo() {
  if (undoStack.length === 0) {
    showToast('Nothing to undo');
    return;
  }
  redoStack.push(clone(state));
  state = keepCurrentCollapse(undoStack.pop());
  save();
  render();
  showToast('Undone');
}

function redo() {
  if (redoStack.length === 0) {
    showToast('Nothing to redo');
    return;
  }
  undoStack.push(clone(state));
  state = keepCurrentCollapse(redoStack.pop());
  save();
  render();
  showToast('Redone');
}

/* ================= Mutations (call inside commit) ================= */

function moveTask(taskId, column, { projectId = null, beforeTaskId = null } = {}) {
  const index = state.tasks.findIndex(task => task.id === taskId);
  if (index < 0) return false;

  const [task] = state.tasks.splice(index, 1);
  if (column === 'done' && task.column !== 'done') task.doneAt = nowIso();
  if (column !== 'done') task.doneAt = null;
  task.column = column;
  if (projectId) task.projectId = projectId;
  if (column === 'done') task.waitingFor = null; // finished = no longer waiting
  task.updatedAt = nowIso();

  const beforeIndex = beforeTaskId ? state.tasks.findIndex(t => t.id === beforeTaskId) : -1;
  if (beforeIndex < 0) {
    state.tasks.push(task);
  } else {
    state.tasks.splice(beforeIndex, 0, task);
  }
  return true;
}

function stepTask(taskId, direction) {
  const task = getTask(taskId);
  if (!task) return false;
  const target = direction > 0 ? NEXT_STEP[task.column] : PREVIOUS_STEP[task.column];
  if (!target) return false;
  return moveTask(taskId, target);
}

function addTask(projectId, text, column = 'pool') {
  state.tasks.push({
    id: uid(),
    text,
    notes: '',
    projectId,
    column: ALL_COLUMNS.includes(column) ? column : 'pool',
    waitingFor: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

function setWaiting(taskId, who) {
  const task = getTask(taskId);
  if (!task) return;
  const cleanWho = String(who || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  commit(() => {
    const current = getTask(taskId);
    current.waitingFor = { who: cleanWho, since: current.waitingFor ? current.waitingFor.since : nowIso() };
    current.updatedAt = nowIso();
  }, { toast: cleanWho ? `⏳ Waiting for ${cleanWho}` : '⏳ Marked as waiting' });
}

function clearWaiting(taskId) {
  const task = getTask(taskId);
  if (!task || !task.waitingFor) return;

  commit(() => {
    const current = getTask(taskId);
    current.waitingFor = null;
    current.updatedAt = nowIso();
  }, { toast: `No longer waiting: “${task.text}”` });
}

function deleteTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  commit(() => {
    state.tasks = state.tasks.filter(t => t.id !== taskId);
  }, { toast: `Deleted “${task.text}”` });
}

function archiveTasks(tasks) {
  const archivedAt = nowIso();
  const ids = new Set(tasks.map(task => task.id));
  const archived = tasks.map(task => ({
    id: task.id,
    text: task.text,
    notes: task.notes,
    projectId: task.projectId,
    projectName: getProject(task.projectId) ? getProject(task.projectId).name : '',
    createdAt: task.createdAt,
    doneAt: task.doneAt || archivedAt,
    archivedAt
  }));
  state.archive = [...archived, ...state.archive];
  state.tasks = state.tasks.filter(task => !ids.has(task.id));
}

function clearDone() {
  const doneTasks = state.tasks.filter(task => task.column === 'done');
  if (doneTasks.length === 0) return;

  commit(() => archiveTasks(doneTasks),
    { toast: `Archived ${doneTasks.length} ${doneTasks.length === 1 ? 'task' : 'tasks'}` });
}

// Each new day, tasks finished on an earlier day move to the archive by themselves.
// Today's finished tasks stay in Done so you can see what you got done today.
let lastAutoClearDay = null;

function autoClearDone() {
  const today = dayKey(new Date());
  if (lastAutoClearDay === today) return;
  lastAutoClearDay = today;
  if (!state.settings || !state.settings.autoClearDone) return;

  const old = state.tasks.filter(task => task.column === 'done' && dayKey(task.doneAt || task.updatedAt) < today);
  if (old.length === 0) return;

  commit(() => archiveTasks(old), {
    toast: `New day: archived ${old.length} ${old.length === 1 ? 'task' : 'tasks'} finished earlier`
  });
}

function setAutoClear(enabled) {
  commit(() => {
    state.settings = { ...defaultSettings(), ...state.settings, autoClearDone: enabled };
  }, { undoable: false, toast: enabled ? 'Done will be cleared each morning' : 'Auto-clear is off – use Clear when you want' });
  if (enabled) {
    lastAutoClearDay = null;
    autoClearDone();
  }
}

function openDoneMenu(x, y) {
  const doneCount = state.tasks.filter(task => task.column === 'done').length;
  const auto = Boolean(state.settings && state.settings.autoClearDone);
  openContextMenu([
    ...(doneCount ? [{ label: `Clear now (${doneCount})`, action: clearDone }] : []),
    { label: `${auto ? '☑' : '☐'} Clear each morning automatically`, action: () => setAutoClear(!auto) },
    null,
    { label: 'Open archive', action: openArchive }
  ], x, y);
}

function restoreFromArchive(archiveId) {
  const item = state.archive.find(entry => entry.id === archiveId);
  if (!item) return;

  commit(() => {
    let project = getProject(item.projectId) ||
      state.projects.find(p => item.projectName && p.name === item.projectName);

    // The project was deleted after archiving – bring it back so the task has a home.
    if (!project) {
      project = { id: uid(), name: item.projectName || 'Restored', color: DEFAULT_COLOR, collapsed: false };
      state.projects.push(project);
    }

    state.archive = state.archive.filter(entry => entry.id !== archiveId);
    state.tasks.push({
      id: getTask(item.id) ? uid() : item.id,
      text: item.text,
      notes: item.notes || '',
      projectId: project.id,
      column: 'pool',
      createdAt: item.createdAt || nowIso(),
      updatedAt: nowIso()
    });
  }, { toast: `Restored “${item.text}” to ${COLUMN_LABELS.pool}` });
}

function deleteFromArchive(archiveId) {
  const item = state.archive.find(entry => entry.id === archiveId);
  if (!item) return;
  commit(() => {
    state.archive = state.archive.filter(entry => entry.id !== archiveId);
  }, { toast: `Deleted “${item.text}” from the archive` });
}

async function emptyArchive() {
  const count = state.archive.length;
  if (count === 0) return;

  const ok = await confirmDialog({
    title: 'Empty the archive?',
    message: `This permanently deletes ${count} archived ${count === 1 ? 'task' : 'tasks'}. You can still undo it right afterwards with Ctrl+Z.`,
    confirmLabel: 'Empty archive',
    danger: true
  });
  if (!ok) return;

  commit(() => {
    state.archive = [];
  }, { toast: 'Archive emptied' });
}

function addProjectFromInput() {
  const name = newProjectInput.value.trim();
  if (name === '') return;

  const id = uid();
  commit(() => {
    state.projects.push({ id, name, color: DEFAULT_COLOR, collapsed: false });
  });
  newProjectInput.value = '';
  lastProjectId = id;
  focusNewTaskInput(id);
}

async function deleteProject(projectId) {
  const project = getProject(projectId);
  if (!project) return;

  const tasks = state.tasks.filter(task => task.projectId === projectId);
  const onBoard = tasks.filter(task => task.column !== 'pool').length;

  if (tasks.length > 0) {
    let message = `This also deletes its ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
    message += onBoard > 0 ? `, including ${onBoard} on the Today board.` : '.';

    const ok = await confirmDialog({
      title: `Delete “${project.name}”?`,
      message,
      confirmLabel: 'Delete project',
      danger: true
    });
    if (!ok) return;
  }

  commit(() => {
    state.projects = state.projects.filter(p => p.id !== projectId);
    state.tasks = state.tasks.filter(task => task.projectId !== projectId);
    if (state.projects.length === 0) {
      state.projects.push({ id: uid(), name: 'Work', color: DEFAULT_COLOR, collapsed: false });
    }
  }, { toast: `Deleted project “${project.name}”` });
}

/* ================= Rendering ================= */

function captureUi() {
  const active = document.activeElement;
  const drafts = {};
  document.querySelectorAll('[data-draft-key]').forEach(input => {
    if (input.value) drafts[input.dataset.draftKey] = input.value;
  });

  return {
    focusKey: active && active.dataset ? active.dataset.focusKey : null,
    selection: active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null,
    drafts,
    rowScroll: [projectsRow.scrollLeft, projectsRow.scrollTop]
  };
}

function restoreUi(snapshot) {
  Object.entries(snapshot.drafts).forEach(([key, value]) => {
    const input = document.querySelector(`[data-draft-key="${CSS.escape(key)}"]`);
    if (input) input.value = value;
  });

  projectsRow.scrollLeft = snapshot.rowScroll[0];
  projectsRow.scrollTop = snapshot.rowScroll[1];

  if (snapshot.focusKey && !currentModal) {
    const target = document.querySelector(`[data-focus-key="${CSS.escape(snapshot.focusKey)}"]`);
    if (target) {
      target.focus({ preventScroll: true });
      if (snapshot.selection && typeof target.setSelectionRange === 'function') {
        try {
          target.setSelectionRange(snapshot.selection[0], snapshot.selection[1]);
        } catch {
          /* not a text input */
        }
      }
    }
  }
}

function render() {
  const ui = captureUi();
  renderBoard();
  renderProjects();
  renderArchiveButton();
  if (currentModal && currentModal.kind === 'archive') renderArchiveList(currentModal);
  restoreUi(ui);
}

function renderBoard() {
  BOARD_COLUMNS.forEach(column => {
    const { list, count } = boardColumns[column];
    const tasks = state.tasks.filter(task => task.column === column);
    list.replaceChildren(...tasks.map(createCard));
    count.textContent = tasks.length ? String(tasks.length) : '';
  });

  clearDoneButton.hidden = !state.tasks.some(task => task.column === 'done');
  clearDoneButton.title = state.settings && state.settings.autoClearDone
    ? 'Archive these now (they also move to the archive automatically tomorrow morning). Right-click the header for options.'
    : 'Move all Done tasks to the archive. Right-click the header to turn on clearing each morning.';
}

function renderArchiveButton() {
  archiveButton.textContent = 'Archive';
}

function createCard(task) {
  const project = getProject(task.projectId);

  const card = make('div', 'task-card');
  card.tabIndex = 0;
  card.draggable = true;
  card.dataset.taskId = task.id;
  card.dataset.projectId = task.projectId;
  card.dataset.focusKey = `task:${task.id}`;

  // On the Today board the project shows as a coloured tag with its short label; in the
  // Task Pool the card already sits under its project, so a colour dot is enough.
  let dot;
  if (task.column === 'pool') {
    dot = make('span', 'task-color-dot');
    dot.style.background = projectColor(task.projectId);
  } else {
    dot = make('span', 'project-tag', projectLabel(task.projectId));
    paintProjectTag(dot, projectColor(task.projectId));
  }
  dot.title = project ? project.name : '';

  const text = make('span', 'task-text', task.text);

  // Text gets the full width; badges go on a line below it and the buttons float on hover.
  const body = make('div', 'task-body');
  body.appendChild(text);

  const meta = make('div', 'task-meta');
  if (task.waitingFor) {
    card.classList.add('is-waiting');
    meta.appendChild(createWaitingBadge(task));
  }
  if (task.notes && task.notes.trim()) {
    const notesIndicator = make('span', 'notes-indicator', '📝');
    notesIndicator.title = task.notes.length > 300 ? `${task.notes.slice(0, 300)}…` : task.notes;
    meta.appendChild(notesIndicator);
  }
  if (meta.childElementCount) body.appendChild(meta);

  card.append(dot, body);

  const editButton = make('button', 'rename-task-button', '✏️');
  editButton.type = 'button';
  editButton.title = 'Edit task and notes (E)';
  editButton.tabIndex = -1;
  editButton.addEventListener('click', event => {
    event.stopPropagation();
    openEditor(task.id);
  });

  const waitingButton = make('button', 'waiting-button', '⏳');
  waitingButton.type = 'button';
  waitingButton.title = task.waitingFor ? 'No longer waiting (W)' : 'Waiting for someone (W)';
  waitingButton.tabIndex = -1;
  waitingButton.addEventListener('click', event => {
    event.stopPropagation();
    toggleWaiting(task.id);
  });

  const deleteButton = make('button', 'delete-button', 'X');
  deleteButton.type = 'button';
  deleteButton.title = 'Delete (Del)';
  deleteButton.tabIndex = -1;
  deleteButton.addEventListener('click', event => {
    event.stopPropagation();
    deleteTask(task.id);
  });

  const actions = make('div', 'task-actions');
  actions.append(waitingButton, editButton, deleteButton);
  card.appendChild(actions);

  // A single click moves the card, a double click opens the editor. The short delay
  // lets us tell the two apart so a double click does not also move the card.
  card.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    if (Date.now() - lastDragEndAt < 150) return;

    clearTimeout(pendingClickTimer);
    if (event.detail > 1) return;

    pendingClickTimer = setTimeout(() => {
      pendingClickTimer = null;
      commit(() => stepTask(task.id, 1));
    }, CLICK_DELAY_MS);
  });

  card.addEventListener('contextmenu', event => {
    event.preventDefault();
    clearTimeout(pendingClickTimer);
    openCardMenu(task.id, event.clientX, event.clientY);
  });

  card.addEventListener('dblclick', event => {
    if (event.target.closest('button')) return;
    clearTimeout(pendingClickTimer);
    pendingClickTimer = null;
    openEditor(task.id);
  });

  card.addEventListener('dragstart', event => {
    draggedTaskId = task.id;
    draggedProjectSection = null;
    card.classList.add('dragging');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
  });

  card.addEventListener('dragend', event => {
    card.classList.remove('dragging');
    draggedTaskId = null;
    lastDragEndAt = Date.now();
    document.querySelectorAll('.drag-over').forEach(zone => zone.classList.remove('drag-over'));
    event.stopPropagation();
  });

  return card;
}

function createWaitingBadge(task) {
  const badge = make('span', 'waiting-badge');
  badge.dataset.taskId = task.id;
  updateWaitingBadge(badge, task.waitingFor);
  return badge;
}

function updateWaitingBadge(badge, waiting) {
  const days = daysSince(waiting.since);
  badge.textContent = `⏳ ${waiting.who ? `${waiting.who} · ` : ''}${waitingDaysLabel(days)}`;
  badge.title = waitingTitle(waiting);
  badge.classList.toggle('stale', days >= WAITING_STALE_DAYS);
}

// Day counters move on while the app stays open (e.g. in the tray overnight).
function refreshWaitingBadges() {
  document.querySelectorAll('.waiting-badge').forEach(badge => {
    const task = getTask(badge.dataset.taskId);
    if (task && task.waitingFor) updateWaitingBadge(badge, task.waitingFor);
  });
}

function renderProjects() {
  projectsRow.replaceChildren(...state.projects.map(createProjectSection));
}

function createProjectSection(project) {
  const tasks = state.tasks.filter(task => task.column === 'pool' && task.projectId === project.id);

  const section = make('div', 'project-section drop-zone');
  if (project.collapsed) section.classList.add('collapsed');
  section.dataset.projectId = project.id;
  section.style.setProperty('--project-color', project.color || DEFAULT_COLOR);

  /* --- header --- */
  const headerRow = make('div', 'project-header-row');
  headerRow.draggable = true;

  headerRow.addEventListener('dragstart', event => {
    draggedProjectSection = section;
    draggedTaskId = null;
    section.classList.add('dragging-project');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
  });

  headerRow.addEventListener('dragend', event => {
    section.classList.remove('dragging-project');
    draggedProjectSection = null;
    event.stopPropagation();

    const newOrder = [...projectsRow.querySelectorAll('.project-section')].map(s => s.dataset.projectId);
    const oldOrder = state.projects.map(p => p.id);

    if (newOrder.join() === oldOrder.join()) {
      render();
      return;
    }

    commit(() => {
      state.projects.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
    });
  });

  const heading = make('h3', '', project.name);
  heading.title = project.collapsed ? 'Click to expand' : 'Click to collapse';
  const count = make('span', 'project-count', tasks.length ? String(tasks.length) : '');
  heading.appendChild(count);

  heading.addEventListener('click', () => {
    commit(() => {
      const p = getProject(project.id);
      if (p) p.collapsed = !p.collapsed;
    }, { undoable: false });
  });

  /* colour picker */
  const colorPickerWrapper = make('div', 'project-color-picker-wrapper');
  const colorPickerButton = make('button', 'project-color-picker-button', '🎨');
  colorPickerButton.type = 'button';
  colorPickerButton.tabIndex = -1;

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.className = 'project-color-picker';
  colorPicker.value = project.color || DEFAULT_COLOR;
  colorPicker.title = 'Project colour';

  // While picking, update the colour live without re-rendering (that would close the picker).
  colorPicker.addEventListener('input', () => {
    section.style.setProperty('--project-color', colorPicker.value);
    document.querySelectorAll(`.task-card[data-project-id="${CSS.escape(project.id)}"] .task-color-dot`)
      .forEach(dot => { dot.style.background = colorPicker.value; });
    document.querySelectorAll(`.task-card[data-project-id="${CSS.escape(project.id)}"] .project-tag`)
      .forEach(tag => paintProjectTag(tag, colorPicker.value));
  });

  colorPicker.addEventListener('change', () => {
    const value = colorPicker.value;
    commit(() => {
      const p = getProject(project.id);
      if (!p || p.color === value) return false;
      p.color = value;
      return true;
    });
  });

  colorPickerWrapper.append(colorPickerButton, colorPicker);

  /* rename */
  const renameButton = make('button', 'rename-project-button', '✏️');
  renameButton.type = 'button';
  renameButton.title = 'Rename project';

  renameButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    startProjectRename(project, headerRow, heading);
  });

  /* delete */
  const deleteButton = make('button', 'delete-project-button', 'X');
  deleteButton.type = 'button';
  deleteButton.title = 'Delete project';

  deleteButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    deleteProject(project.id);
  });

  headerRow.append(heading, colorPickerWrapper, renameButton, deleteButton);

  headerRow.addEventListener('contextmenu', event => {
    event.preventDefault();
    openProjectMenu(project.id, event.clientX, event.clientY, {
      onRename: () => startProjectRename(project, headerRow, heading),
      onColor: () => {
        if (typeof colorPicker.showPicker === 'function') colorPicker.showPicker();
        else colorPicker.click();
      }
    });
  });

  /* --- new task input --- */
  const inputArea = make('div', 'project-task-input-area');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'project-task-input';
  input.placeholder = 'Type a new task';
  input.dataset.focusKey = `newtask:${project.id}`;
  input.dataset.draftKey = `newtask:${project.id}`;

  const addButton = make('button', 'project-add-task-button', 'Add Task');
  addButton.type = 'button';

  function addTaskFromInput() {
    const text = input.value.trim();
    if (text === '') return;
    input.value = '';
    lastProjectId = project.id;
    commit(() => addTask(project.id, text));
  }

  addButton.addEventListener('click', () => {
    addTaskFromInput();
    focusNewTaskInput(project.id);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') addTaskFromInput();
  });
  input.addEventListener('focus', () => {
    lastProjectId = project.id;
  });

  inputArea.append(input, addButton);

  /* --- cards --- */
  const list = make('div', 'card-list');
  list.replaceChildren(...tasks.map(createCard));

  section.append(headerRow, inputArea, list);
  wireDropZone(section, () => ({ column: 'pool', projectId: project.id }));

  return section;
}

function startProjectRename(project, headerRow, heading) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = project.name;
  input.className = 'rename-project-input';

  headerRow.draggable = false; // text selection does not work inside a draggable element
  headerRow.replaceChild(input, heading);
  input.focus();
  input.select();

  let finished = false;

  function finish(saveChange) {
    if (finished) return;
    finished = true;

    const newName = input.value.trim();
    if (!saveChange || newName === '' || newName === project.name) {
      render();
      return;
    }

    commit(() => {
      const p = getProject(project.id);
      if (p) p.name = newName;
    });
  }

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') finish(true);
    else if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

/* ================= Drag and drop ================= */

function getDragAfterElement(list, mouseY) {
  const cards = [...list.querySelectorAll('.task-card:not(.dragging)')];

  let closestCard = null;
  let closestOffset = Number.NEGATIVE_INFINITY;

  cards.forEach(card => {
    const box = card.getBoundingClientRect();
    const offset = mouseY - box.top - box.height / 2;

    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closestCard = card;
    }
  });

  return closestCard;
}

function wireDropZone(zone, getTarget) {
  zone.addEventListener('dragover', event => {
    if (!draggedTaskId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', event => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', event => {
    zone.classList.remove('drag-over');
    if (!draggedTaskId) return;

    event.preventDefault();
    event.stopPropagation();

    const taskId = draggedTaskId;
    const list = zone.querySelector('.card-list');
    const after = getDragAfterElement(list, event.clientY);
    const target = getTarget();

    commit(() => moveTask(taskId, target.column, {
      projectId: target.projectId,
      beforeTaskId: after ? after.dataset.taskId : null
    }));
  });
}

function getProjectAfterElement(container, mouseX) {
  const projects = [...container.querySelectorAll('.project-section:not(.dragging-project)')];

  let closestProject = null;
  let closestOffset = Number.NEGATIVE_INFINITY;

  projects.forEach(project => {
    const box = project.getBoundingClientRect();
    const offset = mouseX - box.left - box.width / 2;

    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closestProject = project;
    }
  });

  return closestProject;
}

function setupProjectReordering() {
  projectsRow.addEventListener('dragover', event => {
    if (!draggedProjectSection) return;
    event.preventDefault();

    const afterElement = getProjectAfterElement(projectsRow, event.clientX);
    if (afterElement == null) {
      projectsRow.appendChild(draggedProjectSection);
    } else if (afterElement !== draggedProjectSection.nextSibling) {
      projectsRow.insertBefore(draggedProjectSection, afterElement);
    }
  });

  projectsRow.addEventListener('drop', event => {
    if (draggedProjectSection) event.preventDefault();
  });
}

/* ================= Toast ================= */

let toastTimer = null;

function showToast(message, { undo: showUndo = false, sticky = false } = {}) {
  clearTimeout(toastTimer);
  toastMessage.textContent = message;
  toastUndo.hidden = !showUndo;
  toastEl.hidden = false;
  toastEl.classList.toggle('toast-error', sticky);

  if (!sticky) {
    toastTimer = setTimeout(hideToast, showUndo ? 6000 : 2500);
  }
}

function hideToast() {
  clearTimeout(toastTimer);
  if (saveFailed) return; // keep the save error visible
  toastEl.hidden = true;
}

toastUndo.addEventListener('click', () => {
  undo();
});

/* ================= Modals ================= */

function openModal({ kind, title, className = '', onCancel }) {
  closeModal();

  const backdrop = make('div', 'modal-backdrop');
  const modal = make('div', `modal ${className}`.trim());
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const heading = make('h3', 'modal-title', title);
  const body = make('div', 'modal-body');
  const footer = make('div', 'modal-footer');

  modal.append(heading, body, footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const returnFocusKey = document.activeElement && document.activeElement.dataset
    ? document.activeElement.dataset.focusKey
    : null;

  const handle = {
    kind,
    backdrop,
    modal,
    body,
    footer,
    returnFocusKey,
    cancel: () => {
      if (onCancel) onCancel();
      closeModal();
    }
  };

  backdrop.addEventListener('mousedown', event => {
    if (event.target === backdrop) handle.cancel();
  });

  currentModal = handle;
  return handle;
}

function closeModal() {
  if (!currentModal) return;
  const { backdrop, returnFocusKey } = currentModal;
  currentModal = null;
  backdrop.remove();

  if (returnFocusKey) {
    const target = document.querySelector(`[data-focus-key="${CSS.escape(returnFocusKey)}"]`);
    if (target) target.focus({ preventScroll: true });
  }
}

function modalButton(label, className, onClick) {
  const button = make('button', className, label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  return new Promise(resolve => {
    const modal = openModal({ kind: 'confirm', title, className: 'modal-small', onCancel: () => resolve(false) });
    modal.body.appendChild(make('p', 'modal-text', message));

    const cancel = modalButton('Cancel', '', () => modal.cancel());
    const confirm = modalButton(confirmLabel, danger ? 'button-danger' : 'button-primary', () => {
      closeModal();
      resolve(true);
    });

    modal.footer.append(make('span', 'modal-footer-spacer'), cancel, confirm);
    confirm.focus();
  });
}

function openProjectLabelDialog(projectId) {
  const project = getProject(projectId);
  if (!project) return;

  const automatic = autoShortLabel(project.name);
  const modal = openModal({ kind: 'project-label', title: `Short label for “${project.name}”`, className: 'modal-small' });

  const label = make('label', 'field');
  label.appendChild(make('span', 'field-label', `Up to ${MAX_LABEL_LENGTH} characters. Leave empty for the automatic label.`));
  const row = make('div', 'label-row');
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = MAX_LABEL_LENGTH;
  input.value = cleanShortLabel(project.shortLabel);
  input.placeholder = automatic;
  const preview = make('span', 'project-tag project-tag-preview');
  const updatePreview = () => {
    preview.textContent = cleanShortLabel(input.value) || projectLabel(projectId);
    paintProjectTag(preview, project.color || DEFAULT_COLOR);
  };
  input.addEventListener('input', updatePreview);
  row.append(input, preview);
  label.appendChild(row);
  modal.body.appendChild(label);
  updatePreview();

  const save = () => {
    const value = cleanShortLabel(input.value);
    closeModal();
    commit(() => {
      const current = getProject(projectId);
      if (!current || cleanShortLabel(current.shortLabel) === value) return false;
      current.shortLabel = value;
      return true;
    }, { toast: value ? `Label for ${project.name}: ${value}` : `${project.name} uses the automatic label again` });
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });

  modal.footer.append(
    make('span', 'modal-footer-spacer'),
    modalButton('Cancel', '', () => modal.cancel()),
    modalButton('Save', 'button-primary', save)
  );
  input.focus();
  input.select();
}

function toggleWaiting(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  if (task.waitingFor) {
    clearWaiting(taskId);
  } else {
    openWaitingPrompt(taskId);
  }
}

function openWaitingPrompt(taskId) {
  const task = getTask(taskId);
  if (!task) return;

  const modal = openModal({ kind: 'waiting', title: 'Waiting for…', className: 'modal-small' });
  modal.body.appendChild(make('p', 'modal-text modal-task-text', task.text));

  const label = make('label', 'field');
  label.appendChild(make('span', 'field-label', 'Who are you waiting on? (optional)'));
  const input = document.createElement('input');
  input.type = 'text';
  input.value = suggestWaitingName(task.text);
  input.placeholder = 'Name';
  label.appendChild(input);
  modal.body.appendChild(label);

  const save = () => {
    const who = input.value;
    closeModal();
    setWaiting(taskId, who);
  };

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });

  modal.footer.append(
    make('span', 'modal-footer-spacer'),
    modalButton('Cancel', '', () => modal.cancel()),
    modalButton('Mark as waiting', 'button-primary', save)
  );

  input.focus();
  input.select();
}

function openEditor(taskId) {
  const task = getTask(taskId);
  if (!task) return;

  const modal = openModal({ kind: 'editor', title: 'Edit task', className: 'modal-editor' });

  const titleLabel = make('label', 'field');
  titleLabel.appendChild(make('span', 'field-label', 'Task'));
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = task.text;
  titleLabel.appendChild(titleInput);

  const projectLabel = make('label', 'field');
  projectLabel.appendChild(make('span', 'field-label', 'Project'));
  const projectSelect = document.createElement('select');
  state.projects.forEach(project => {
    const option = make('option', '', project.name);
    option.value = project.id;
    option.selected = project.id === task.projectId;
    projectSelect.appendChild(option);
  });
  projectLabel.appendChild(projectSelect);

  const notesLabel = make('label', 'field');
  notesLabel.appendChild(make('span', 'field-label', 'Notes'));
  const notesInput = document.createElement('textarea');
  notesInput.rows = 8;
  notesInput.value = task.notes || '';
  notesInput.placeholder = 'Details, links, next steps…';
  notesLabel.appendChild(notesInput);

  const waitingField = make('div', 'field waiting-field');
  const waitingToggleLabel = make('label', 'checkbox-label');
  const waitingCheckbox = document.createElement('input');
  waitingCheckbox.type = 'checkbox';
  waitingCheckbox.checked = Boolean(task.waitingFor);
  waitingToggleLabel.append(waitingCheckbox, make('span', '', '⏳ Waiting for someone'));
  const waitingInput = document.createElement('input');
  waitingInput.type = 'text';
  waitingInput.placeholder = 'Name (optional)';
  waitingInput.value = task.waitingFor ? task.waitingFor.who : suggestWaitingName(task.text);
  waitingInput.disabled = !waitingCheckbox.checked;
  const waitingSince = make('span', 'field-hint',
    task.waitingFor ? `since ${formatDate(task.waitingFor.since)} (${daysSince(task.waitingFor.since)} d)` : '');
  waitingCheckbox.addEventListener('change', () => {
    waitingInput.disabled = !waitingCheckbox.checked;
    if (waitingCheckbox.checked) {
      waitingInput.focus();
      waitingInput.select();
    }
  });
  const waitingRow = make('div', 'waiting-row');
  waitingRow.append(waitingToggleLabel, waitingInput, waitingSince);
  waitingField.appendChild(waitingRow);

  const meta = make('p', 'modal-meta',
    `In ${COLUMN_LABELS[task.column]} · created ${formatDate(task.createdAt)}` +
    (task.updatedAt && task.updatedAt !== task.createdAt ? ` · updated ${formatDate(task.updatedAt)}` : ''));

  modal.body.append(titleLabel, projectLabel, waitingField, notesLabel, meta);

  function saveEdits() {
    const text = titleInput.value.trim() || task.text;
    const notes = notesInput.value.replace(/\s+$/, '');
    const projectId = projectSelect.value;
    const waitingWho = waitingInput.value.replace(/\s+/g, ' ').trim().slice(0, 80);
    const wantsWaiting = waitingCheckbox.checked;

    closeModal();

    commit(() => {
      const current = getTask(taskId);
      if (!current) return false;

      const waitingFor = wantsWaiting
        ? { who: waitingWho, since: current.waitingFor ? current.waitingFor.since : nowIso() }
        : null;
      const waitingChanged = JSON.stringify(waitingFor) !== JSON.stringify(current.waitingFor || null);

      if (current.text === text && (current.notes || '') === notes && current.projectId === projectId && !waitingChanged) {
        return false;
      }
      current.text = text;
      current.notes = notes;
      current.projectId = projectId;
      current.waitingFor = waitingFor;
      current.updatedAt = nowIso();
      return true;
    });
  }

  const deleteButton = modalButton('Delete', 'button-danger-subtle', () => {
    closeModal();
    deleteTask(taskId);
  });
  const cancelButton = modalButton('Cancel', '', () => modal.cancel());
  const saveButton = modalButton('Save', 'button-primary', saveEdits);
  saveButton.title = 'Save (Ctrl+Enter)';

  modal.footer.append(deleteButton, make('span', 'modal-footer-spacer'), cancelButton, saveButton);

  [titleInput, waitingInput].forEach(input => input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveEdits();
    }
  }));

  modal.modal.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      saveEdits();
    }
  });

  titleInput.focus();
  titleInput.select();
}

function openArchive() {
  const modal = openModal({ kind: 'archive', title: 'Archive', className: 'modal-archive' });
  modal.query = '';
  modal.projectFilter = null;
  renderArchiveList(modal);
  if (modal.searchInput) modal.searchInput.focus();
}

function archiveDayLabel(key) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - DAY_MS));
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

// A project key for the archive filter: the live project, or a deleted one by name.
function archiveProjectKey(item) {
  return getProject(item.projectId) ? item.projectId : `deleted:${item.projectName || ''}`;
}

function archiveMatches(item, query) {
  if (!query) return true;
  const project = getProject(item.projectId);
  const haystack = [item.text, item.notes, project ? project.name : item.projectName, project ? projectLabel(project.id) : '']
    .join(' ').toLocaleLowerCase('sv');
  return query.toLocaleLowerCase('sv').split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

function renderArchiveList(modal) {
  modal.footer.replaceChildren();

  if (state.archive.length === 0) {
    modal.body.replaceChildren(make('p', 'modal-text',
      'No archived tasks yet. Finished tasks move here each morning, or when you press “Clear” in the Done column.'));
    modal.searchInput = null;
    modal.footer.append(make('span', 'modal-footer-spacer'), modalButton('Close', 'button-primary', () => closeModal()));
    return;
  }

  // Controls are built once so the search field keeps focus and text while the list updates.
  if (!modal.controls || !modal.body.contains(modal.controls)) {
    modal.body.replaceChildren();
    modal.controls = make('div', 'archive-controls');
    modal.searchInput = document.createElement('input');
    modal.searchInput.type = 'search';
    modal.searchInput.className = 'archive-search';
    modal.searchInput.placeholder = 'Search the archive…';
    modal.searchInput.value = modal.query || '';
    modal.searchInput.addEventListener('input', () => {
      modal.query = modal.searchInput.value;
      renderArchiveList(modal);
    });
    modal.filterRow = make('div', 'archive-filters');
    modal.controls.append(modal.searchInput, modal.filterRow);
    modal.results = make('div', 'archive-results');
    modal.body.append(modal.controls, modal.results);
  }

  // Project filter chips: only projects that have archived tasks.
  const projectKeys = [];
  state.archive.forEach(item => {
    const key = archiveProjectKey(item);
    if (!projectKeys.includes(key)) projectKeys.push(key);
  });
  projectKeys.sort((a, b) => {
    const index = key => {
      const i = state.projects.findIndex(p => p.id === key);
      return i < 0 ? 999 : i;
    };
    return index(a) - index(b);
  });
  if (modal.projectFilter && !projectKeys.includes(modal.projectFilter)) modal.projectFilter = null;

  const chip = (key, labelText, color, title) => {
    const button = make('button', 'archive-filter');
    button.type = 'button';
    button.title = title;
    button.classList.toggle('selected', modal.projectFilter === key);
    if (key) {
      const tag = make('span', 'project-tag', labelText);
      paintProjectTag(tag, color);
      button.appendChild(tag);
    } else {
      button.textContent = labelText;
    }
    button.addEventListener('click', () => {
      modal.projectFilter = modal.projectFilter === key ? null : key;
      renderArchiveList(modal);
    });
    return button;
  };
  modal.filterRow.replaceChildren(
    chip(null, 'All projects', null, 'Show every project'),
    ...projectKeys.map(key => {
      const project = getProject(key);
      if (project) return chip(key, projectLabel(key), project.color, project.name);
      const name = key.slice('deleted:'.length) || 'Unknown';
      return chip(key, autoShortLabel(name), '#9aa5b1', `${name} (deleted)`);
    })
  );
  if (!modal.projectFilter) modal.filterRow.firstChild.classList.add('selected');

  // Results grouped by the day the task was finished.
  const items = state.archive
    .filter(item => !modal.projectFilter || archiveProjectKey(item) === modal.projectFilter)
    .filter(item => archiveMatches(item, modal.query))
    .sort((a, b) => String(b.doneAt || b.archivedAt).localeCompare(String(a.doneAt || a.archivedAt)));

  modal.results.replaceChildren();
  if (items.length === 0) {
    modal.results.appendChild(make('p', 'modal-text archive-empty', 'No archived tasks match.'));
  }

  let currentDay = null;
  let group = null;
  items.forEach(item => {
    const key = dayKey(item.doneAt || item.archivedAt);
    if (key !== currentDay) {
      currentDay = key;
      const heading = make('div', 'archive-day');
      heading.append(make('span', '', archiveDayLabel(key)));
      heading.dataset.day = key;
      group = make('div', 'archive-list');
      modal.results.append(heading, group);
    }
    group.appendChild(createArchiveRow(item));
    const count = group.childElementCount;
    group.previousSibling.dataset.count = String(count);
  });
  modal.results.querySelectorAll('.archive-day').forEach(heading => {
    heading.appendChild(make('span', 'archive-day-count', heading.dataset.count === '1' ? '1 task' : `${heading.dataset.count} tasks`));
  });

  const shown = items.length === state.archive.length ? `${items.length} archived` : `${items.length} of ${state.archive.length}`;
  modal.footer.append(
    modalButton('Empty archive', 'button-danger-subtle', emptyArchive),
    make('span', 'archive-total', shown),
    make('span', 'modal-footer-spacer'),
    modalButton('Close', 'button-primary', () => closeModal())
  );
}

function createArchiveRow(item) {
  const row = make('div', 'archive-item');
  const project = getProject(item.projectId);

  const tag = make('span', 'project-tag', project ? projectLabel(project.id) : autoShortLabel(item.projectName || '?'));
  paintProjectTag(tag, project ? project.color : '#9aa5b1');
  tag.title = project ? project.name : `${item.projectName || 'Unknown project'} (deleted)`;

  const info = make('div', 'archive-info');
  info.appendChild(make('div', 'archive-text', item.text));
  const projectName = project ? project.name : (item.projectName ? `${item.projectName} (deleted)` : '');
  info.appendChild(make('div', 'archive-meta', [projectName, `archived ${formatDate(item.archivedAt)}`].filter(Boolean).join(' · ')));
  if (item.notes) info.appendChild(make('div', 'archive-notes', item.notes));

  const restore = modalButton('Restore', '', () => restoreFromArchive(item.id));
  restore.title = 'Put back in the Task Pool';
  const remove = modalButton('Delete', 'button-danger-subtle', () => deleteFromArchive(item.id));

  row.append(tag, info, restore, remove);
  return row;
}

function openShortcuts() {
  const modal = openModal({ kind: 'shortcuts', title: 'Keyboard shortcuts', className: 'modal-small' });

  const rows = [
    ['Ctrl+Alt+K', 'Quick add from any program (also works with the window closed)'],
    ['N', 'New task in the last used project'],
    ['P', 'New project'],
    ['Ctrl+Z', 'Undo'],
    ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
    ['?', 'Show this list'],
    ['Esc', 'Close dialog / leave a text field'],
    ['', 'With the mouse over a card:'],
    ['W', 'Mark as waiting for someone / no longer waiting'],
    ['E', 'Edit task and notes'],
    ['Right-click', 'Menu: waiting, edit, move, delete'],
    ['', 'Right-click the Done header:'],
    ['Right-click', 'Clear now, turn clearing each morning on/off, open the archive'],
    ['', 'Right-click a project header:'],
    ['Right-click', 'Rename, short label, colour, delete'],
    ['', 'With a card selected using the keyboard (Tab):'],
    ['Enter / →', 'Move to the next step'],
    ['←', 'Move back one step'],
    ['↑ / ↓', 'Select the card above / below'],
    ['E', 'Edit task and notes'],
    ['W', 'Mark as waiting for someone / no longer waiting'],
    ['Delete', 'Delete task'],
    ['', 'In the edit dialog:'],
    ['Ctrl+Enter', 'Save']
  ];

  const table = make('table', 'shortcut-table');
  rows.forEach(([keys, description]) => {
    const tr = document.createElement('tr');
    if (!keys) {
      const th = make('th', '', description);
      th.colSpan = 2;
      tr.appendChild(th);
    } else {
      const keyCell = document.createElement('td');
      keys.split(' / ').forEach((key, index) => {
        if (index > 0) keyCell.append(' / ');
        keyCell.appendChild(make('kbd', '', key));
      });
      tr.append(keyCell, make('td', '', description));
    }
    table.appendChild(tr);
  });

  modal.body.appendChild(table);
  const close = modalButton('Close', 'button-primary', () => closeModal());
  modal.footer.append(make('span', 'modal-footer-spacer'), close);
  close.focus();
}

/* ================= Keyboard ================= */

/* ---------- Card under the mouse ---------- */

// W and E act on the card under the mouse pointer, so you don't have to select it first
// (a click moves the card and a double-click opens the editor).
let pointer = null;
document.addEventListener('mousemove', event => {
  pointer = { x: event.clientX, y: event.clientY };
}, { passive: true });
document.documentElement.addEventListener('mouseleave', () => {
  pointer = null;
});
window.addEventListener('blur', () => {
  pointer = null;
});

function cardUnderPointer() {
  if (!pointer) return null;
  const element = document.elementFromPoint(pointer.x, pointer.y);
  return element && element.closest ? element.closest('.task-card') : null;
}

/* ---------- Right-click menus ---------- */

let cardMenu = null; // the open context menu (cards or project headers)

function closeCardMenu() {
  if (!cardMenu) return;
  cardMenu.element.remove();
  cardMenu = null;
}

// entries: [{ label, shortcut, action, className }] with null for a separator.
function openContextMenu(entries, x, y) {
  closeCardMenu();

  const element = make('div', 'context-menu');
  element.setAttribute('role', 'menu');
  const items = [];

  entries.forEach(entry => {
    if (!entry) {
      element.appendChild(make('div', 'context-menu-separator'));
      return;
    }
    const item = make('button', `context-menu-item ${entry.className || ''}`.trim());
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.append(make('span', 'context-menu-label', entry.label));
    if (entry.shortcut) item.append(make('kbd', '', entry.shortcut));
    item.addEventListener('click', () => {
      closeCardMenu();
      entry.action();
    });
    element.appendChild(item);
    items.push({ item, shortcut: entry.shortcut, action: entry.action });
  });

  document.body.appendChild(element);

  // Keep the menu inside the window.
  const box = element.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - box.width - 8);
  const top = y + box.height > window.innerHeight - 8 ? Math.max(8, y - box.height) : y;
  element.style.left = `${Math.max(8, left)}px`;
  element.style.top = `${top}px`;

  cardMenu = { element, items };
  items[0].item.focus();
}

function openCardMenu(taskId, x, y) {
  const task = getTask(taskId);
  if (!task) return;

  openContextMenu([
    { label: task.waitingFor ? '⏳ No longer waiting' : '⏳ Waiting for…', shortcut: 'W', action: () => toggleWaiting(taskId) },
    { label: '✏️ Edit', shortcut: 'E', action: () => openEditor(taskId) },
    null,
    ...['pool', 'todo', 'doing', 'done']
      .filter(column => column !== task.column)
      .map(column => ({ label: `Move to ${COLUMN_LABELS[column]}`, action: () => commit(() => moveTask(taskId, column)) })),
    null,
    { label: 'Delete', shortcut: 'Del', action: () => deleteTask(taskId), className: 'context-menu-danger' }
  ], x, y);
}

function openProjectMenu(projectId, x, y, { onRename, onColor }) {
  const project = getProject(projectId);
  if (!project) return;

  openContextMenu([
    { label: '✏️ Rename', action: onRename },
    { label: `🏷️ Short label (${projectLabel(projectId)})…`, action: () => openProjectLabelDialog(projectId) },
    { label: '🎨 Change colour', action: onColor },
    null,
    { label: 'Delete project…', action: () => deleteProject(projectId), className: 'context-menu-danger' }
  ], x, y);
}

document.addEventListener('mousedown', event => {
  if (cardMenu && !cardMenu.element.contains(event.target)) closeCardMenu();
}, true);
window.addEventListener('blur', closeCardMenu);
window.addEventListener('resize', closeCardMenu);
document.addEventListener('scroll', closeCardMenu, true);

function handleCardMenuKey(event) {
  const buttons = cardMenu.items.map(entry => entry.item);
  const index = buttons.indexOf(document.activeElement);
  const key = event.key;

  if (key === 'Escape') {
    event.preventDefault();
    closeCardMenu();
  } else if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault();
    const step = key === 'ArrowDown' ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length].focus();
  } else if (key === 'Tab') {
    event.preventDefault();
  } else if (key === 'Enter' || key === ' ') {
    event.preventDefault();
    if (index >= 0) buttons[index].click();
  } else {
    const shortcut = key === 'Delete' || key === 'Backspace' ? 'Del' : key.toUpperCase();
    const entry = cardMenu.items.find(item => item.shortcut === shortcut);
    if (entry) {
      event.preventDefault();
      entry.item.click();
    }
  }
}

function focusNewTaskInput(projectId) {
  let project = getProject(projectId) || getProject(lastProjectId) || state.projects[0];
  if (!project) return;

  if (project.collapsed) {
    commit(() => {
      getProject(project.id).collapsed = false;
    }, { undoable: false });
  }

  const input = document.querySelector(`[data-focus-key="newtask:${CSS.escape(project.id)}"]`);
  if (input) {
    input.focus();
    input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function focusSiblingCard(card, direction) {
  const cards = [...card.parentElement.querySelectorAll('.task-card')];
  const next = cards[cards.indexOf(card) + direction];
  if (next) {
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }
}

function handleCardKey(event, card) {
  const taskId = card.dataset.taskId;

  switch (event.key) {
    case 'Enter':
    case ' ':
    case 'ArrowRight':
      event.preventDefault();
      commit(() => stepTask(taskId, 1));
      return true;
    case 'ArrowLeft':
      event.preventDefault();
      commit(() => stepTask(taskId, -1));
      return true;
    case 'ArrowUp':
      event.preventDefault();
      focusSiblingCard(card, -1);
      return true;
    case 'ArrowDown':
      event.preventDefault();
      focusSiblingCard(card, 1);
      return true;
    case 'e':
    case 'E':
    case 'F2':
      event.preventDefault();
      openEditor(taskId);
      return true;
    case 'w':
    case 'W':
      event.preventDefault();
      toggleWaiting(taskId);
      return true;
    case 'Delete':
    case 'Backspace': {
      event.preventDefault();
      const cards = [...card.parentElement.querySelectorAll('.task-card')];
      const neighbour = cards[cards.indexOf(card) + 1] || cards[cards.indexOf(card) - 1];
      deleteTask(taskId);
      if (neighbour) {
        const target = document.querySelector(`[data-focus-key="${CSS.escape(neighbour.dataset.focusKey)}"]`);
        if (target) target.focus();
      }
      return true;
    }
    default:
      return false;
  }
}

document.addEventListener('keydown', event => {
  if (cardMenu) {
    handleCardMenuKey(event);
    return;
  }

  if (currentModal) {
    if (event.key === 'Escape') {
      event.preventDefault();
      currentModal.cancel();
    }
    return;
  }

  const typing = isTypingTarget(event.target);
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (mod && !event.altKey && !typing) {
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
  }

  if (typing) {
    if (event.key === 'Escape') event.target.blur();
    return;
  }

  if (mod || event.altKey) return;

  // W/E: the card under the mouse wins over a card that merely has focus from an earlier click.
  if (key === 'w' || key === 'e') {
    const hovered = cardUnderPointer();
    if (hovered) {
      event.preventDefault();
      if (key === 'w') toggleWaiting(hovered.dataset.taskId);
      else openEditor(hovered.dataset.taskId);
      return;
    }
  }

  const card = event.target.closest ? event.target.closest('.task-card') : null;
  if (card && handleCardKey(event, card)) return;

  if (key === 'n') {
    event.preventDefault();
    focusNewTaskInput(lastProjectId);
  } else if (key === 'p') {
    event.preventDefault();
    newProjectInput.focus();
  } else if (event.key === '?') {
    event.preventDefault();
    openShortcuts();
  }
});

/* ================= Wiring ================= */

BOARD_COLUMNS.forEach(column => {
  wireDropZone(boardColumns[column].zone, () => ({ column, projectId: null }));
});

addProjectButton.addEventListener('click', addProjectFromInput);
newProjectInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') addProjectFromInput();
});

clearDoneButton.addEventListener('click', clearDone);
boardColumns.done.zone.querySelector('.column-header').addEventListener('contextmenu', event => {
  event.preventDefault();
  openDoneMenu(event.clientX, event.clientY);
});
archiveButton.addEventListener('click', openArchive);
shortcutsButton.addEventListener('click', openShortcuts);

setupProjectReordering();

if (storage) {
  storage.onImported(raw => {
    const data = normalizeData(raw);
    if (!data) {
      showToast('That file could not be imported.');
      return;
    }
    closeModal();
    commit(() => {
      state = data;
    }, { toast: 'Backup imported' });
  });

  // Tasks typed into the quick-add box (global hotkey) arrive here.
  if (typeof storage.onQuickAdd === 'function') storage.onQuickAdd(task => {
    const text = task && typeof task.text === 'string' ? task.text.trim() : '';
    if (!text) return;

    const project = getProject(task.projectId) || state.projects[0];
    const column = task.column === 'todo' ? 'todo' : 'pool';

    commit(() => addTask(project.id, text, column), {
      toast: `Added “${text}” to ${column === 'todo' ? COLUMN_LABELS.todo : project.name}`
    });
  });

  storage.onCommand(command => {
    if (command === 'undo') undo();
    else if (command === 'redo') redo();
    else if (command === 'shortcuts') openShortcuts();
    else if (command === 'archive') openArchive();
    else if (command === 'day-check') autoClearDone();
  });
}

setInterval(refreshWaitingBadges, 15 * 60 * 1000);
window.addEventListener('focus', refreshWaitingBadges);

// The app often stays open in the tray overnight, so look for a new day regularly.
setInterval(autoClearDone, 60 * 1000);
window.addEventListener('focus', autoClearDone);

async function init() {
  let data = null;
  let migrated = false;

  try {
    data = normalizeData(await loadRawData());
  } catch (err) {
    console.error('Could not load data', err);
    savingBlocked = true;
    state = defaultData();
    render();
    saveFailed = true;
    showToast(`Could not load your data, so saving is turned off to protect it. Restart the app or check File → Open data folder. (${err && err.message ? err.message : err})`, { sticky: true });
    return;
  }

  if (!data) {
    const legacy = readLegacyLocalStorage();
    data = legacy ? normalizeData(legacy) : null;
    migrated = Boolean(data);
  }

  state = data || defaultData();
  save();
  render();

  if (migrated && storage) {
    showToast('Your tasks now live in a data file (File → Open data folder).');
  }

  autoClearDone();
}

init();
