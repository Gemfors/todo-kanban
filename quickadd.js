'use strict';

/*
 * Quick add – the small box that opens with the global hotkey.
 *
 * Choosing the project without the mouse:
 *   ↑ / ↓ (or Tab / Shift+Tab)  step through the projects
 *   Alt+1 … Alt+9 (or Ctrl+1…9)  jump to a numbered project
 *   #name in the text             start of the name, part of it or its initials (#sales, #upph, #lam)
 */

const DEFAULT_COLOR = '#4f46e5';

const box = document.querySelector('#qa');
const textInput = document.querySelector('#qa-text');
const chipRow = document.querySelector('#qa-projects');
const dot = document.querySelector('#qa-dot');
const hint = document.querySelector('#qa-hint');
const statusLine = document.querySelector('#qa-status');

const bridge = window.quickAdd || {
  // Lets the page work in a normal browser for testing.
  onOpen: () => {},
  ready: () => {},
  resize: () => {},
  submit: task => console.log('submit', task),
  close: () => console.log('close')
};

let projects = [];
let chosenProjectId = null; // picked with keys/mouse, or remembered from last time
let statusTimer = null;
let flashActive = false;

/* ---------- Matching #tags ---------- */

function normalize(value) {
  return String(value || '').toLocaleLowerCase('sv').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');
}

function initials(name) {
  return String(name || '')
    .split(/[\s/&_-]+/)
    .filter(Boolean)
    .map(word => word[0])
    .join('')
    .toLocaleLowerCase('sv');
}

function findProject(query) {
  const q = normalize(query);
  if (!q) return null;
  return projects.find(p => normalize(p.name).startsWith(q)) ||
    projects.find(p => initials(p.name).startsWith(q)) ||
    projects.find(p => normalize(p.name).includes(q)) ||
    null;
}

// Finds the last "#tag" in the text and the project it points to.
function findTag(text) {
  const matches = [...text.matchAll(/(^|\s)#([^\s#]+)/gu)];
  if (matches.length === 0) return null;

  const match = matches[matches.length - 1];
  return {
    tag: match[2],
    index: match.index,
    length: match[0].length,
    project: findProject(match[2])
  };
}

function removeTag(text, tag) {
  return `${text.slice(0, tag.index)} ${text.slice(tag.index + tag.length)}`;
}

function projectById(id) {
  return projects.find(p => p.id === id) || null;
}

/* ---------- Rendering ---------- */

function currentProject() {
  const tag = findTag(textInput.value);
  if (tag && tag.project) return tag.project;
  return projectById(chosenProjectId) || projects[0] || null;
}

function renderChips() {
  chipRow.replaceChildren(...projects.map((project, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.tabIndex = -1;
    chip.className = 'qa-chip';
    chip.dataset.projectId = project.id;
    chip.setAttribute('role', 'option');
    chip.title = index < 9 ? `${project.name}  (Alt+${index + 1})` : project.name;
    chip.style.setProperty('--chip-color', project.color || DEFAULT_COLOR);

    const key = document.createElement('span');
    key.className = 'qa-chip-key';
    key.textContent = index < 9 ? String(index + 1) : '·';

    const name = document.createElement('span');
    name.className = 'qa-chip-name';
    name.textContent = project.name;

    chip.append(key, name);
    chip.addEventListener('mousedown', event => event.preventDefault()); // keep focus in the text field
    chip.addEventListener('click', () => chooseProject(project.id));
    return chip;
  }));
}

function update() {
  const tag = findTag(textInput.value);
  const project = currentProject();

  chipRow.querySelectorAll('.qa-chip').forEach(chip => {
    const selected = Boolean(project) && chip.dataset.projectId === project.id;
    chip.classList.toggle('selected', selected);
    chip.setAttribute('aria-selected', String(selected));
  });

  dot.style.background = (project && project.color) || DEFAULT_COLOR;

  if (tag && !tag.project && tag.tag) {
    showStatus(`No project matches #${tag.tag} – it will stay in the text`, { warning: true });
  } else if (!flashActive) {
    clearStatus();
  }
}

function showStatus(message, { warning = false, flash = false } = {}) {
  clearTimeout(statusTimer);
  statusLine.textContent = message;
  statusLine.classList.toggle('qa-warning', warning);
  statusLine.hidden = false;
  hint.hidden = true;

  if (flash) {
    flashActive = true;
    statusTimer = setTimeout(() => {
      flashActive = false;
      update();
    }, 1600);
  }
}

function clearStatus() {
  clearTimeout(statusTimer);
  flashActive = false;
  statusLine.hidden = true;
  hint.hidden = false;
}

function boxHeight() {
  return Math.ceil(box.getBoundingClientRect().height) + 2; // + body border
}

/* ---------- Actions ---------- */

function chooseProject(projectId) {
  if (!projectById(projectId)) return;
  chosenProjectId = projectId;

  // An explicit choice wins over a #tag, so take the tag out of the text.
  const tag = findTag(textInput.value);
  if (tag && tag.project) {
    textInput.value = removeTag(textInput.value, tag).replace(/\s+/g, ' ').trimStart();
  }

  update();
  textInput.focus();
}

function stepProject(direction) {
  if (projects.length === 0) return;
  const current = currentProject();
  const index = Math.max(0, projects.findIndex(p => current && p.id === current.id));
  const next = (index + direction + projects.length) % projects.length;
  chooseProject(projects[next].id);
}

function open(payload) {
  projects = Array.isArray(payload && payload.projects) ? payload.projects : [];
  chosenProjectId = payload && projectById(payload.lastProjectId)
    ? payload.lastProjectId
    : (projects[0] ? projects[0].id : null);

  renderChips();
  textInput.value = '';
  clearStatus();

  if (projects.length === 0) {
    textInput.disabled = true;
    showStatus('Open Todo Kanban once so quick add knows your projects.', { warning: true });
  } else {
    textInput.disabled = false;
  }

  update();
  textInput.focus();
  requestAnimationFrame(() => bridge.ready(boxHeight()));
}

function submit({ toToday = false, keepOpen = false } = {}) {
  let text = textInput.value;
  const tag = findTag(text);
  const project = currentProject();

  if (tag && tag.project) text = removeTag(text, tag);
  text = text.replace(/\s+/g, ' ').trim();
  if (!text || !project) return;

  chosenProjectId = project.id;
  bridge.submit({ text, projectId: project.id, column: toToday ? 'todo' : 'pool', keepOpen });

  if (keepOpen) {
    textInput.value = '';
    update();
    showStatus(`✓ Added to ${toToday ? 'To Do' : project.name}`, { flash: true });
    textInput.focus();
  }
}

/* ---------- Keyboard ---------- */

function digitFromEvent(event) {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || '');
  return match ? Number(match[1]) : null;
}

textInput.addEventListener('input', update);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    bridge.close();
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    submit({ toToday: event.ctrlKey || event.metaKey, keepOpen: event.shiftKey });
    return;
  }

  // Alt+digit or Ctrl+digit. (Ctrl+Alt together is AltGr, which types @ £ $ { [ ] } – leave it alone.)
  const digit = digitFromEvent(event);
  if (digit && event.altKey !== event.ctrlKey) {
    event.preventDefault();
    if (projects[digit - 1]) chooseProject(projects[digit - 1].id);
    return;
  }

  if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
    event.preventDefault();
    stepProject(1);
  } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
    event.preventDefault();
    stepProject(-1);
  }
});

// Keep the window height in step with the content (e.g. when the project list wraps).
let lastReportedHeight = 0;
new ResizeObserver(() => {
  const height = boxHeight();
  if (Math.abs(height - lastReportedHeight) > 1) {
    lastReportedHeight = height;
    bridge.resize(height);
  }
}).observe(box);

bridge.onOpen(open);
window.__quickAddOpen = open; // used by tests
