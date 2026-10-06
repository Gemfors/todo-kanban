const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');
const stateFile = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile));
  } catch {
    return { width: 1200, height: 800, isMaximized: false };
  }
}

function saveWindowState(win) {
  if (win.isDestroyed()) return;

  const bounds = win.getBounds();

  const state = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: win.isMaximized()
  };

  fs.writeFileSync(stateFile, JSON.stringify(state));
}

function createWindow() {

  const windowState = loadWindowState();

  const win = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  if (windowState.isMaximized) {
    win.maximize();
  }

  win.loadFile('index.html');

  win.on('close', () => {
    saveWindowState(win);
  });
}

app.whenReady().then(() => {
  createWindow();
});