'use strict';

/*
 * Quick add – the small box that opens with the global hotkey.
 * Type a task, optionally "#name" to choose a project (prefix, part of the name
 * or initials: #sales, #upph, #lam), then Enter.
 */

const DEFAULT_COLOR = '#4f46e5';

const textInput = document.querySelector('#qa-text');
const projectSelect = document.querySelector('#qa-project');
const dot = document.querySelector('#qa-dot');
const hint = document.querySelector('#qa-hint');
const statusLine = document.querySelector('#qa-status');

const bridge = window.quickAdd || {
  // Lets the page work in a normal browser for testing.
  onOpen: () => {},
  submit: task => console.log('submit', task),
  close: () => console.log('close')
};

let projects = [];
let chosenProjectId = null; // last project picked in the dropdown or remembered from before
let statusTimer = null;

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

function projectById(id) {
  return projects.find(p => p.id === id) || null;
}

function showStatus(message, warning = false) {
  clearTimeout(statusTimer);
  statusLine.textContent = message;
  statusLine.classList.toggle('qa-warning', warning);
  statusLine.hidden = false;
  hint.hidden = true;

  if (!warning) {
    statusTimer = setTimeout(clearStatus, 1600);
  }
}

function clearStatus() {
  clearTimeout(statusTimer);
  statusLine.hidden = true;
  hint.hidden = false;
}

function update() {
  const tag = findTag(textInput.value);
  let project = projectById(chosenProjectId) || projects[0] || null;

  if (tag && tag.project) {
    project = tag.project;
    showStatus(`→ ${project.name}`);
    clearTimeout(statusTimer); // keep it visible while the tag is there
  } else if (tag && tag.tag) {
    showStatus(`No project matches #${tag.tag} – it will stay in the text`, true);
  } else if (!statusLine.classList.contains('qa-added')) {
    clearStatus();
  }

  if (project) projectSelect.value = project.id;
  dot.style.background = (project && project.color) || DEFAULT_COLOR;
}

function fillProjects() {
  projectSelect.replaceChildren(...projects.map(project => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    return option;
  }));
}

function open(payload) {
  projects = Array.isArray(payload && payload.projects) ? payload.projects : [];
  chosenProjectId = payload && projectById(payload.lastProjectId) ? payload.lastProjectId : (projects[0] ? projects[0].id : null);

  fillProjects();
  textInput.value = '';
  statusLine.classList.remove('qa-added');
  clearStatus();

  if (projects.length === 0) {
    textInput.disabled = true;
    showStatus('Open Todo Kanban once so quick add knows your projects.', true);
  } else {
    textInput.disabled = false;
  }

  update();
  textInput.focus();
}

function submit({ toToday = false, keepOpen = false } = {}) {
  let text = textInput.value;
  const tag = findTag(text);
  let projectId = projectSelect.value || chosenProjectId;

  if (tag && tag.project) {
    projectId = tag.project.id;
    text = `${text.slice(0, tag.index)} ${text.slice(tag.index + tag.length)}`;
  }

  text = text.replace(/\s+/g, ' ').trim();
  if (!text || !projectId) return;

  chosenProjectId = projectId;
  bridge.submit({ text, projectId, column: toToday ? 'todo' : 'pool', keepOpen });

  if (keepOpen) {
    const project = projectById(projectId);
    textInput.value = '';
    update();
    statusLine.classList.add('qa-added');
    showStatus(`✓ Added to ${toToday ? 'To Do' : (project ? project.name : 'Task Pool')}`);
    setTimeout(() => statusLine.classList.remove('qa-added'), 1600);
    textInput.focus();
  }
}

textInput.addEventListener('input', update);

projectSelect.addEventListener('change', () => {
  chosenProjectId = projectSelect.value;

  // Picking from the list wins over a #tag: remove the tag from the text.
  const tag = findTag(textInput.value);
  if (tag && tag.project) {
    const value = textInput.value;
    textInput.value = `${value.slice(0, tag.index)} ${value.slice(tag.index + tag.length)}`.replace(/\s+/g, ' ').trimStart();
  }
  update();
  textInput.focus();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    bridge.close();
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    submit({ toToday: event.ctrlKey || event.metaKey, keepOpen: event.shiftKey });
  }
});

bridge.onOpen(open);
window.__quickAddOpen = open; // used by tests
