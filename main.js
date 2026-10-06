const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell } = require('electron');

const userDataDir = app.getPath('userData');
const stateFile = path.join(userDataDir, 'window-state.json');
const dataFile = path.join(userDataDir, 'kanban-data.json');
const dataBackupFile = path.join(userDataDir, 'kanban-data.bak.json');
const dailyBackupDir = path.join(userDataDir, 'backups');
const DAILY_BACKUPS_TO_KEEP = 14;

let mainWindow = null;
let lastData = null;

// Only one instance may run, otherwise two windows would overwrite each other's data file.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/* ---------- Window state ---------- */

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return { width: 1200, height: 800, isMaximized: false };
  }
}

function isOnSomeDisplay(state) {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return false;

  return screen.getAllDisplays().some(display => {
    const area = display.workArea;
    return (
      state.x < area.x + area.width - 50 &&
      state.x + state.width > area.x + 50 &&
      state.y >= area.y - 10 &&
      state.y < area.y + area.height - 50
    );
  });
}

function saveWindowState(win) {
  if (win.isDestroyed()) return;

  // getNormalBounds gives the un-maximized size, so restoring from maximized works.
  const bounds = win.getNormalBounds();

  const state = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: win.isMaximized()
  };

  try {
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } catch (err) {
    console.error('Could not save window state', err);
  }
}

/* ---------- Data file ---------- */

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadData() {
  if (!fs.existsSync(dataFile) && !fs.existsSync(dataBackupFile)) {
    return null;
  }

  for (const file of [dataFile, dataBackupFile]) {
    try {
      if (fs.existsSync(file)) {
        const data = readJson(file);
        lastData = data;
        return data;
      }
    } catch (err) {
      console.error(`Could not read ${file}`, err);
    }
  }

  // Both files exist but are unreadable: keep them aside so nothing is lost.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const file of [dataFile, dataBackupFile]) {
    if (fs.existsSync(file)) {
      fs.renameSync(file, file.replace(/\.json$/, `.corrupt-${stamp}.json`));
    }
  }
  return null;
}

function writeFileAtomic(file, content) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Rename can fail on Windows if another program holds the file; fall back to a direct write.
    fs.writeFileSync(file, content, 'utf8');
    fs.rmSync(tmp, { force: true });
  }
}

function writeDailyBackup(content) {
  fs.mkdirSync(dailyBackupDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const todayFile = path.join(dailyBackupDir, `kanban-${today}.json`);

  if (!fs.existsSync(todayFile)) {
    fs.writeFileSync(todayFile, content, 'utf8');
  }

  const backups = fs.readdirSync(dailyBackupDir)
    .filter(name => /^kanban-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();

  backups.slice(0, Math.max(0, backups.length - DAILY_BACKUPS_TO_KEEP)).forEach(name => {
    fs.rmSync(path.join(dailyBackupDir, name), { force: true });
  });
}

function saveData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects) || !Array.isArray(data.tasks)) {
    throw new Error('Refusing to save invalid data');
  }

  const content = JSON.stringify(data, null, 2);
  fs.mkdirSync(userDataDir, { recursive: true });

  if (fs.existsSync(dataFile)) {
    fs.copyFileSync(dataFile, dataBackupFile);
  }

  writeFileAtomic(dataFile, content);
  lastData = data;

  try {
    writeDailyBackup(content);
  } catch (err) {
    console.error('Could not write daily backup', err);
  }
}

ipcMain.handle('data:load', () => loadData());
ipcMain.handle('data:save', (_event, data) => {
  saveData(data);
  return true;
});

/* ---------- Export / import ---------- */

async function exportBackup() {
  if (!lastData) {
    await dialog.showMessageBox(mainWindow, { type: 'info', message: 'There is nothing to export yet.' });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export backup',
    defaultPath: path.join(app.getPath('documents'), `todo-kanban-backup-${today}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (canceled || !filePath) return;

  try {
    fs.writeFileSync(filePath, JSON.stringify(lastData, null, 2), 'utf8');
  } catch (err) {
    dialog.showErrorBox('Export failed', err.message);
  }
}

async function importBackup() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (canceled || !filePaths || !filePaths[0]) return;

  let data;
  try {
    data = readJson(filePaths[0]);
    if (!data || !Array.isArray(data.projects) || !Array.isArray(data.tasks)) {
      throw new Error('This file does not look like a Todo Kanban backup.');
    }
  } catch (err) {
    dialog.showErrorBox('Import failed', err.message);
    return;
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Replace my board', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Replace your current board with this backup?',
    detail: `${data.projects.length} projects and ${data.tasks.length} tasks. You can undo this with Ctrl+Z.`
  });

  if (response === 0) {
    mainWindow.webContents.send('data:imported', data);
  }
}

function sendCommand(command) {
  if (mainWindow) mainWindow.webContents.send('app:command', command);
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Export backup…', click: exportBackup },
        { label: 'Import backup…', click: importBackup },
        { type: 'separator' },
        { label: 'Open data folder', click: () => shell.openPath(userDataDir) },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: () => sendCommand('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', registerAccelerator: false, click: () => sendCommand('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Archive', click: () => sendCommand('archive') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard shortcuts', click: () => sendCommand('shortcuts') },
        { type: 'separator' },
        {
          label: 'About Todo Kanban',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'About Todo Kanban',
            message: `Todo Kanban ${app.getVersion()}`,
            detail: `Electron ${process.versions.electron}\nData folder: ${userDataDir}`
          })
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- Window ---------- */

function createWindow() {
  const windowState = loadWindowState();
  const onScreen = isOnSomeDisplay(windowState);

  mainWindow = new BrowserWindow({
    width: windowState.width || 1200,
    height: windowState.height || 800,
    x: onScreen ? windowState.x : undefined,
    y: onScreen ? windowState.y : undefined,
    title: `Todo Kanban ${app.getVersion()}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  // Keep the version in the title bar instead of the page's <title>.
  mainWindow.on('page-title-updated', event => event.preventDefault());

  mainWindow.loadFile('index.html');

  mainWindow.on('close', () => {
    saveWindowState(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
