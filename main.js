const fs = require('fs');
const path = require('path');
const {
  app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, screen, shell
} = require('electron');

const userDataDir = app.getPath('userData');
const stateFile = path.join(userDataDir, 'window-state.json');
const settingsFile = path.join(userDataDir, 'settings.json');
const dataFile = path.join(userDataDir, 'kanban-data.json');
const dataBackupFile = path.join(userDataDir, 'kanban-data.bak.json');
const dailyBackupDir = path.join(userDataDir, 'backups');
const DAILY_BACKUPS_TO_KEEP = 14;

const DEFAULT_QUICK_ADD_SHORTCUT = 'CommandOrControl+Alt+K';
const QUICK_ADD_WIDTH = 580;
const QUICK_ADD_HEIGHT = 116;

const startHidden = process.argv.includes('--hidden');

let mainWindow = null;
let quickAddWindow = null;
let tray = null;
let lastData = null;
let isQuitting = false;
let pendingMaximize = false;
let registeredShortcut = null;
let settings = {};

// Only one instance may run, otherwise two windows would overwrite each other's data file.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  showMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

/* ---------- Settings ---------- */

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    /* first run */
  }

  return {
    quickAddShortcut: DEFAULT_QUICK_ADD_SHORTCUT,
    startWithWindows: true,
    trayHintShown: false,
    lastQuickAddProjectId: null,
    ...saved
  };
}

function saveSettings() {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Could not save settings', err);
  }
}

function shortcutLabel(accelerator = registeredShortcut || settings.quickAddShortcut) {
  return String(accelerator || '')
    .replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl')
    .replace(/\+/g, '+');
}

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
  if (!win || win.isDestroyed()) return;

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
  if (!mainWindow) return;
  showMainWindow();
  mainWindow.webContents.send('app:command', command);
}

/* ---------- Quick add ---------- */

function createQuickAddWindow() {
  quickAddWindow = new BrowserWindow({
    width: QUICK_ADD_WIDTH,
    height: QUICK_ADD_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Quick add',
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'quickadd-preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  quickAddWindow.setAlwaysOnTop(true, 'screen-saver');
  quickAddWindow.loadFile('quickadd.html');

  quickAddWindow.on('blur', () => {
    if (quickAddWindow && !quickAddWindow.webContents.isDevToolsOpened()) quickAddWindow.hide();
  });

  quickAddWindow.on('closed', () => {
    quickAddWindow = null;
  });
}

function quickAddPayload() {
  const projects = lastData && Array.isArray(lastData.projects)
    ? lastData.projects.map(p => ({ id: p.id, name: p.name, color: p.color }))
    : [];

  return {
    projects,
    lastProjectId: settings.lastQuickAddProjectId,
    shortcut: shortcutLabel()
  };
}

function showQuickAdd() {
  if (!quickAddWindow || quickAddWindow.isDestroyed()) createQuickAddWindow();

  const win = quickAddWindow;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;

  win.setBounds({
    x: Math.round(area.x + (area.width - QUICK_ADD_WIDTH) / 2),
    y: Math.round(area.y + area.height * 0.22),
    width: QUICK_ADD_WIDTH,
    height: QUICK_ADD_HEIGHT
  });

  const open = () => {
    win.webContents.send('quickadd:open', quickAddPayload());
    win.show();
    win.focus();
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', open);
  } else {
    open();
  }
}

ipcMain.on('quickadd:submit', (_event, task) => {
  const text = task && typeof task.text === 'string' ? task.text.trim() : '';
  if (!text || !mainWindow) return;

  const column = task.column === 'todo' ? 'todo' : 'pool';
  const projectId = typeof task.projectId === 'string' ? task.projectId : null;

  mainWindow.webContents.send('quickadd:task', { text, projectId, column });

  if (projectId) {
    settings.lastQuickAddProjectId = projectId;
    saveSettings();
  }

  if (!task.keepOpen && quickAddWindow) quickAddWindow.hide();
});

ipcMain.on('quickadd:close', () => {
  if (quickAddWindow) quickAddWindow.hide();
});

function registerQuickAddShortcut() {
  globalShortcut.unregisterAll();
  registeredShortcut = null;

  const accelerator = settings.quickAddShortcut || DEFAULT_QUICK_ADD_SHORTCUT;
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, showQuickAdd);
  } catch (err) {
    console.error('Invalid quick add shortcut', accelerator, err);
  }

  if (ok) {
    registeredShortcut = accelerator;
    return;
  }

  const message = `Couldn't set up ${shortcutLabel(accelerator)} for quick add. Another program is probably using it.`;
  if (tray && startHidden) {
    tray.displayBalloon({ title: 'Todo Kanban', content: message, iconType: 'warning' });
  } else {
    dialog.showMessageBox({
      type: 'warning',
      message,
      detail: `You can still use File → Quick add task. To pick another key, change "quickAddShortcut" in ${settingsFile} and restart the app.`
    });
  }
}

/* ---------- Tray and start with Windows ---------- */

function trayIconPath() {
  return process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'tray.png');
}

function applyStartWithWindows() {
  // Only the installed app should register itself; `npm start` would register electron.exe.
  if (!app.isPackaged) return;

  app.setLoginItemSettings({
    openAtLogin: Boolean(settings.startWithWindows),
    path: process.execPath,
    args: ['--hidden']
  });
}

function setStartWithWindows(enabled) {
  settings.startWithWindows = enabled;
  saveSettings();
  applyStartWithWindows();
  buildMenu();
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;

  tray.setToolTip(registeredShortcut
    ? `Todo Kanban – ${shortcutLabel()} to add a task`
    : 'Todo Kanban');

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Todo Kanban', click: showMainWindow },
    { label: `Quick add task${registeredShortcut ? `\t${shortcutLabel()}` : ''}`, click: showQuickAdd },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: Boolean(settings.startWithWindows),
      enabled: app.isPackaged,
      click: item => setStartWithWindows(item.checked)
    },
    { type: 'separator' },
    { label: 'Quit Todo Kanban', click: () => app.quit() }
  ]));
}

function createTray() {
  tray = new Tray(trayIconPath());
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  buildTrayMenu();
}

/* ---------- Menu ---------- */

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Quick add task',
          accelerator: registeredShortcut || undefined,
          registerAccelerator: false,
          click: showQuickAdd
        },
        { type: 'separator' },
        { label: 'Export backup…', click: exportBackup },
        { label: 'Import backup…', click: importBackup },
        { type: 'separator' },
        { label: 'Open data folder', click: () => shell.openPath(userDataDir) },
        {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: Boolean(settings.startWithWindows),
          enabled: app.isPackaged,
          click: item => setStartWithWindows(item.checked)
        },
        { type: 'separator' },
        { label: 'Close window (keeps running in the tray)', accelerator: 'CmdOrCtrl+W', click: () => mainWindow && mainWindow.close() },
        { label: 'Quit Todo Kanban', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
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
            detail: [
              `Quick add: ${registeredShortcut ? shortcutLabel() : 'not available'}`,
              `Electron ${process.versions.electron}`,
              `Data folder: ${userDataDir}`
            ].join('\n')
          })
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- Main window ---------- */

function showMainWindow() {
  if (!mainWindow) return;

  if (!mainWindow.isVisible()) {
    if (pendingMaximize) {
      pendingMaximize = false;
      mainWindow.maximize(); // also shows the window
    }
    mainWindow.show();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createWindow() {
  const windowState = loadWindowState();
  const onScreen = isOnSomeDisplay(windowState);

  mainWindow = new BrowserWindow({
    width: windowState.width || 1200,
    height: windowState.height || 800,
    x: onScreen ? windowState.x : undefined,
    y: onScreen ? windowState.y : undefined,
    show: false,
    title: `Todo Kanban ${app.getVersion()}`,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  pendingMaximize = Boolean(windowState.isMaximized);

  // Keep the version in the title bar instead of the page's <title>.
  mainWindow.on('page-title-updated', event => event.preventDefault());

  mainWindow.loadFile('index.html');

  // Closing the window hides it to the tray so the quick-add hotkey keeps working.
  mainWindow.on('close', event => {
    saveWindowState(mainWindow);
    if (isQuitting) return;

    event.preventDefault();
    mainWindow.hide();

    if (!settings.trayHintShown && tray) {
      tray.displayBalloon({
        title: 'Todo Kanban is still running',
        content: `Press ${shortcutLabel()} anywhere to add a task. Quit from the tray icon.`,
        iconType: 'info'
      });
      settings.trayHintShown = true;
      saveSettings();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (!startHidden) showMainWindow();
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  if (process.platform === 'win32') app.setAppUserModelId('com.olle.todo-kanban');

  settings = loadSettings();
  saveSettings();
  applyStartWithWindows();

  createTray();
  createWindow();
  createQuickAddWindow();
  registerQuickAddShortcut();
  buildMenu();
  buildTrayMenu();
});

app.on('window-all-closed', () => {
  app.quit();
});
