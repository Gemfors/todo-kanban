'use strict';
// Minimal stand-in for the parts of Electron that main.js uses, so the main process can be
// exercised in plain Node. State is exposed on global.__S for the test to inspect.
const S = global.__S = { handlers:{}, on:{}, appEvents:{}, windows:[], shortcuts:{}, balloons:[], dialogs:[], login:null, registerOk: true, packaged: process.env.PKG!=='0' };
class WC { constructor(w){ this.w=w; this.sent=[]; this.once={}; } send(c,d){ this.sent.push([c,d]); } isLoading(){ return false; } isDevToolsOpened(){ return false; } }
class BW { constructor(o){ this.opts=o; this.ev={}; this.visible=!!(o.show!==false); this.webContents=new WC(this); this.maximized=false; S.windows.push(this); }
  on(e,cb){ (this.ev[e] ||= []).push(cb); } emit(e,...a){ (this.ev[e]||[]).forEach(cb=>cb(...a)); }
  loadFile(f){ this.file=f; } show(){ this.visible=true; } hide(){ this.visible=false; } focus(){} isVisible(){ return this.visible; }
  maximize(){ this.maximized=true; this.visible=true; } isMinimized(){ return false; } restore(){} setBounds(b){ this.bounds=b; } getBounds(){ return this.bounds||{x:0,y:0,width:640,height:150}; } setMenu(m){ this.menu=m; } setAppDetails(d){ this.appDetails=d; }
  setAlwaysOnTop(){} isDestroyed(){ return false; } getNormalBounds(){ return {x:0,y:0,width:900,height:700}; } isMaximized(){ return this.maximized; }
  close(){ let prevented=false; this.emit('close', { preventDefault(){ prevented=true; } }); if(!prevented){ this.closed=true; this.emit('closed'); } return prevented; } }
class Tray { constructor(icon){ this.icon=icon; S.tray=this; this.ev={}; } on(e,cb){ this.ev[e]=cb; } setToolTip(t){ this.tip=t; } setContextMenu(m){ this.menu=m; } displayBalloon(b){ S.balloons.push(b); } }
module.exports = {
  app: { getPath: k => process.env.MOCK_UD + (k==='userData' ? '' : '/docs'), getVersion: () => 'test', get isPackaged(){ return S.packaged; },
    requestSingleInstanceLock: () => true, quit(){ S.quit=true; }, on(e,cb){ S.appEvents[e]=cb; }, whenReady(){ return { then(cb){ S.ready=cb; } }; },
    setLoginItemSettings(o){ S.login=o; }, setAppUserModelId(id){ S.aumid=id; } },
  BrowserWindow: BW, Tray,
  Menu: { buildFromTemplate: t => t, setApplicationMenu: m => { S.menu = m; } },
  dialog: { showMessageBox: async (...a) => { S.dialogs.push(a[a.length-1]); return {response:1}; }, showErrorBox(){} },
  globalShortcut: { register(acc, cb){ if (!S.registerOk) return false; S.shortcuts[acc]=cb; return true; }, unregisterAll(){ S.shortcuts={}; } },
  ipcMain: { handle: (c, fn) => { S.handlers[c] = fn; }, on: (c, fn) => { S.on[c] = fn; } },
  screen: { getAllDisplays: () => [{ workArea: { x:0, y:0, width:1920, height:1080 } }], getCursorScreenPoint: () => ({x:2500,y:100}),
    getDisplayNearestPoint: () => ({ workArea: { x:1920, y:0, width:2560, height:1440 } }) },
  shell: { openPath(){} }
};
