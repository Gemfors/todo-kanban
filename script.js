const todoColumn = document.querySelector('#todo-column');
const doingColumn = document.querySelector('#doing-column');
const doneColumn = document.querySelector('#done-column');
const newProjectInput = document.querySelector('#new-project-input');
const addProjectButton = document.querySelector('#add-project-button');

let draggedCard = null;
let draggedProject = null;
let justDragged = false;

function getProjectSection(projectName) {
  const projectSections = document.querySelectorAll('.project-section');

  for (const section of projectSections) {
    const heading = section.querySelector('h3');
    if (heading && heading.textContent === projectName) {
      return section;
    }
  }

  return document.querySelector('.project-section');
}

function getProjectColor(projectName) {
  const projectSection = getProjectSection(projectName);

  if (!projectSection) {
    return '#4f46e5';
  }

  const colorPicker = projectSection.querySelector('.project-color-picker');

  if (!colorPicker) {
    return '#4f46e5';
  }

  return colorPicker.value || '#4f46e5';
}

function updateTaskColor(card) {
  const colorDot = card.querySelector('.task-color-dot');

  if (!colorDot) {
    return;
  }

  const projectName = card.dataset.project || 'Work';
  colorDot.style.background = getProjectColor(projectName);
}

function updateAllTasksForProject(projectName) {
  document.querySelectorAll('.task-card').forEach(card => {
    if ((card.dataset.project || 'Work') === projectName) {
      updateTaskColor(card);
    }
  });
}

function getCardProjectName(card) {
  const projectSection = card.closest('.project-section');
  if (!projectSection) {
    return card.dataset.project || '';
  }

  const heading = projectSection.querySelector('h3');
  return heading ? heading.textContent : '';
}

function getCardColumn(card) {
  if (card.parentElement === todoColumn) {
    return 'todo';
  }

  if (card.parentElement === doingColumn) {
    return 'doing';
  }

  if (card.parentElement === doneColumn) {
    return 'done';
  }

  return 'pool';
}

function moveCardToNextStep(card) {
  if (card.parentElement === todoColumn) {
    doingColumn.appendChild(card);
  } else if (card.parentElement === doingColumn) {
    doneColumn.appendChild(card);
  } else if (card.parentElement === doneColumn) {
    const projectName = card.dataset.project || 'Work';
    const projectSection = getProjectSection(projectName);
    projectSection.appendChild(card);
  } else {
    card.dataset.project = getCardProjectName(card) || card.dataset.project || 'Work';
    todoColumn.appendChild(card);
  }

  saveTasks();
}

function saveTasks() {
  const tasks = [];

  document.querySelectorAll('.task-card').forEach(card => {
    tasks.push({
      text: card.querySelector('.task-text').textContent,
      column: getCardColumn(card),
      project: getCardProjectName(card) || card.dataset.project || 'Work'
    });
  });

  localStorage.setItem('tasks', JSON.stringify(tasks));
}

function saveProjects() {
  const projects = [];

  document.querySelectorAll('.project-section').forEach(section => {
    const heading = section.querySelector('h3');
    const colorPicker = section.querySelector('.project-color-picker');

    projects.push({
      name: heading.textContent,
      collapsed: section.classList.contains('collapsed'),
      color: colorPicker ? colorPicker.value : '#4f46e5'
    });
  });

  localStorage.setItem('projects', JSON.stringify(projects));
}

function loadProjects() {
  const savedProjects = localStorage.getItem('projects');

  if (!savedProjects) {
    saveProjects();
    return;
  }

  const savedProjectData = JSON.parse(savedProjects);
  const projectsRow = document.querySelector('.projects-row');

  projectsRow.innerHTML = '';

  savedProjectData.forEach(project => {
    createProject(project.name);

    const section = getProjectSection(project.name);

    if (section) {
      const colorPicker = section.querySelector('.project-color-picker');

      if (colorPicker && project.color) {
        colorPicker.value = project.color;
        section.style.setProperty('--project-color', project.color);
      }

      if (project.collapsed) {
        section.classList.add('collapsed');
      }
    }
  });
}

function makeCardInteractive(card) {
  card.setAttribute('draggable', 'true');

  card.addEventListener('click', (event) => {
    if (event.target.classList.contains('delete-button')) {
      return;
    }

    if (justDragged) {
      justDragged = false;
      return;
    }

    moveCardToNextStep(card);
  });

  card.addEventListener('dragstart', (event) => {
    draggedCard = card;
    draggedProject = null;
    card.classList.add('dragging');
    event.stopPropagation();
  });

  card.addEventListener('dragend', (event) => {
    card.classList.remove('dragging');
    draggedCard = null;
    justDragged = true;

    setTimeout(() => {
      justDragged = false;
    }, 100);

    saveTasks();
    event.stopPropagation();
  });
}

function addTaskRenameButton(card, textSpan) {
  const renameButton = document.createElement('button');
  renameButton.className = 'rename-task-button';
  renameButton.textContent = '✏️';

  renameButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const oldText = textSpan.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldText;
    input.className = 'rename-task-input';

    card.replaceChild(input, textSpan);
    input.focus();
    input.select();

    function finishRename(saveChange) {
      const newTextSpan = document.createElement('span');
      newTextSpan.className = 'task-text';
      newTextSpan.textContent = saveChange ? input.value.trim() || oldText : oldText;

      card.replaceChild(newTextSpan, input);
      textSpan = newTextSpan;
      saveTasks();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finishRename(true);
      } else if (e.key === 'Escape') {
        finishRename(false);
      }
    });

    input.addEventListener('blur', () => {
      finishRename(true);
    });
  });

  card.appendChild(renameButton);
}

function addDeleteButton(card) {
  const deleteButton = document.createElement('button');
  deleteButton.className = 'delete-button';
  deleteButton.textContent = 'X';

  deleteButton.addEventListener('click', (event) => {
    event.stopPropagation();
    card.remove();
    saveTasks();
  });

  card.appendChild(deleteButton);
}

function createTaskCard(taskText, columnName, projectName) {
  const newCard = document.createElement('div');
  newCard.className = 'task-card';
  newCard.dataset.project = projectName || 'Work';

  const colorDot = document.createElement('span');
  colorDot.className = 'task-color-dot';

  const projectColor = getProjectColor(projectName);
  colorDot.style.background = projectColor;

  let textSpan = document.createElement('span');
  textSpan.className = 'task-text';
  textSpan.textContent = taskText;

  newCard.appendChild(colorDot);
  newCard.appendChild(textSpan);

  addTaskRenameButton(newCard, textSpan);
  addDeleteButton(newCard);
  makeCardInteractive(newCard);

  if (columnName === 'todo') {
    todoColumn.appendChild(newCard);
  } else if (columnName === 'doing') {
    doingColumn.appendChild(newCard);
  } else if (columnName === 'done') {
    doneColumn.appendChild(newCard);
  } else {
    const projectSection = getProjectSection(projectName || 'Work');
    projectSection.appendChild(newCard);
  }
}

function createProject(projectName) {
  const projectsRow = document.querySelector('.projects-row');

  const projectSection = document.createElement('div');
  projectSection.className = 'project-section drop-zone';
  projectSection.style.setProperty('--project-color', '#4f46e5');

  const headerRow = document.createElement('div');
  headerRow.className = 'project-header-row';
  
  headerRow.setAttribute('draggable', 'true');

  headerRow.addEventListener('dragstart', (event) => {
    draggedProject = projectSection;
    projectSection.classList.add('dragging-project');
    event.stopPropagation();
  });

  headerRow.addEventListener('dragend', (event) => {
    projectSection.classList.remove('dragging-project');
    draggedProject = null;
    saveProjects();
    event.stopPropagation();
  });
  
  let heading = document.createElement('h3');
  heading.textContent = projectName;

  heading.addEventListener('click', () => {
    projectSection.classList.toggle('collapsed');
    saveProjects();
  });

  const colorPickerWrapper = document.createElement('div');
  colorPickerWrapper.className = 'project-color-picker-wrapper';

  const colorPickerButton = document.createElement('button');
  colorPickerButton.className = 'project-color-picker-button';
  colorPickerButton.textContent = '🎨';
  colorPickerButton.type = 'button';

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.className = 'project-color-picker';
  colorPicker.value = '#4f46e5';

  colorPickerButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (typeof colorPicker.showPicker === 'function') {
      colorPicker.showPicker();
    } else {
      colorPicker.click();
    }
  });

  colorPicker.addEventListener('input', () => {
    projectSection.style.setProperty('--project-color', colorPicker.value);
    updateAllTasksForProject(heading.textContent);
    saveProjects();
    saveTasks();
  });

  colorPickerWrapper.appendChild(colorPickerButton);
  colorPickerWrapper.appendChild(colorPicker);
   
  const renameProjectButton = document.createElement('button');
  renameProjectButton.className = 'rename-project-button';
  renameProjectButton.textContent = '✏️';

  renameProjectButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const oldName = heading.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.className = 'rename-project-input';

    headerRow.replaceChild(input, heading);
    input.focus();
    input.select();

    function finishRename(saveChange) {
      const newHeading = document.createElement('h3');
      newHeading.textContent = saveChange ? input.value.trim() || oldName : oldName;

      newHeading.addEventListener('click', () => {
        projectSection.classList.toggle('collapsed');
        saveProjects();
      });

      headerRow.replaceChild(newHeading, input);
      heading = newHeading;

      saveProjects();
      saveTasks();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finishRename(true);
      } else if (e.key === 'Escape') {
        finishRename(false);
      }
    });

    input.addEventListener('blur', () => {
      finishRename(true);
    });
  });

  const deleteProjectButton = document.createElement('button');
  deleteProjectButton.className = 'delete-project-button';
  deleteProjectButton.textContent = 'X';
  
  deleteProjectButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    projectSection.querySelectorAll('.task-card').forEach(card => {
        card.remove();
    });

    projectSection.remove();
    saveProjects();
    saveTasks();
  });

  headerRow.appendChild(heading);
  headerRow.appendChild(colorPickerWrapper);
  headerRow.appendChild(renameProjectButton);
  headerRow.appendChild(deleteProjectButton);

  deleteProjectButton.addEventListener('click', (event) => {
    event.stopPropagation();

    projectSection.querySelectorAll('.task-card').forEach(card => {
      card.remove();
    });

    projectSection.remove();
    saveProjects();
    saveTasks();
  });

  const inputArea = document.createElement('div');
  inputArea.className = 'project-task-input-area';

  const input = document.createElement('input');
  input.className = 'project-task-input';
  input.placeholder = 'Type a new task';

  const button = document.createElement('button');
  button.className = 'project-add-task-button';
  button.textContent = 'Add Task';

  inputArea.appendChild(input);
  inputArea.appendChild(button);

  projectSection.appendChild(headerRow);
  projectSection.appendChild(inputArea);

  projectsRow.appendChild(projectSection);

  setupDropZones();
  setupProjectAddButtons();
}

function getDragAfterElement(zone, mouseY) {
  const cards = [...zone.querySelectorAll('.task-card:not(.dragging)')];

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

function setupDropZones() {
  const dropZones = document.querySelectorAll('.drop-zone');

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (event) => {
      zone.classList.remove('drag-over');
      event.preventDefault();

      if (!draggedCard) {
        return;
      }

      if (zone.classList.contains('project-section')) {
        const heading = zone.querySelector('h3');
        if (heading) {
          draggedCard.dataset.project = heading.textContent;
          updateTaskColor(draggedCard);
        }
      }

      const afterElement = getDragAfterElement(zone, event.clientY);

      if (afterElement == null) {
        zone.appendChild(draggedCard);
      } else {
        zone.insertBefore(draggedCard, afterElement);
      }

      saveTasks();
    });
  });
}

function setupProjectAddButtons() {
  const projectSections = document.querySelectorAll('.project-section');

  projectSections.forEach(section => {
    const input = section.querySelector('.project-task-input');
    const button = section.querySelector('.project-add-task-button');
    const heading = section.querySelector('h3');

    if (!input || !button || !heading) {
      return;
    }

    function addTaskFromInput() {
      const taskText = input.value.trim();

      if (taskText === '') {
        return;
      }

      const currentProjectName = heading.textContent.trim();

      createTaskCard(taskText, 'pool', currentProjectName);
      input.value = '';
      saveTasks();
    }

    button.addEventListener('click', () => {
      addTaskFromInput();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        addTaskFromInput();
      }
    });
  });
}

function loadTasks() {
  const savedTasks = localStorage.getItem('tasks');

  document.querySelectorAll('.task-card').forEach(card => card.remove());

  if (!savedTasks) {
    createTaskCard('Fix login bug', 'pool', 'Work');
    createTaskCard('Write project proposal', 'pool', 'Work');
    createTaskCard('Prepare slides', 'pool', 'Presentations');
    saveTasks();
    return;
  }

  const tasks = JSON.parse(savedTasks);

  tasks.forEach(task => {
    createTaskCard(task.text, task.column, task.project || 'Work');
  });
}

function addProjectFromInput() {
  const projectName = newProjectInput.value.trim();

  if (projectName === '') {
    return;
  }

  createProject(projectName);
  saveProjects();
  newProjectInput.value = '';
}

addProjectButton.addEventListener('click', () => {
  addProjectFromInput();
});

newProjectInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    addProjectFromInput();
  }
});

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
  const projectsRow = document.querySelector('.projects-row');

  projectsRow.addEventListener('dragover', (event) => {
    if (!draggedProject) {
      return;
    }

    event.preventDefault();

    const afterElement = getProjectAfterElement(projectsRow, event.clientX);

    if (afterElement == null) {
      projectsRow.appendChild(draggedProject);
    } else {
      projectsRow.insertBefore(draggedProject, afterElement);
    }
  });

  projectsRow.addEventListener('drop', (event) => {
    if (!draggedProject) {
      return;
    }

    event.preventDefault();
    saveProjects();
  });
}

loadProjects();
setupDropZones();
setupProjectAddButtons();
setupProjectReordering();
loadTasks();