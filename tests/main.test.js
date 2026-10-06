'use strict';
// Main process (main.js) against a mocked Electron: quick-add hotkey and window, tray,
// close-to-tray, start with Windows, data saving, Windows taskbar identity.
// Each scenario runs in its own Node process because main.js keeps module-level state.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const SCENARIOS = [
  { name: 'normal', env: {} },
  { name: 'hidden', env: {}, args: ['--hidden'] },
  { name: 'fail', env: {} },
  { name: 'dev', env: { PKG: '0' } },
  { name: 'win32', env: {} },
  { name: 'data', env: {} }
];

if (!process.env.MAIN_TEST_SCENARIO) {
  let failed = 0;
  let passed = 0;
  for (const scenario of SCENARIOS) {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-main-'));
    const result = spawnSync(process.execPath, [__filename, ...(scenario.args || [])], {
      env: { ...process.env, ...scenario.env, MAIN_TEST_SCENARIO: scenario.name, MOCK_UD: ud },
      encoding: 'utf8'
    });
    const output = (result.stdout || '') + (result.stderr || '');
    output.split('\n').filter(Boolean).forEach(line => console.log(line));
    passed += (output.match(/^PASS/gm) || []).length;
    const scenarioFailed = (output.match(/^FAIL/gm) || []).length + (result.status ? 1 : 0);
    failed += scenarioFailed;
    fs.rmSync(ud, { recursive: true, force: true });
  }
  console.log(`main: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
  return;
}

/* ---------- child: one scenario ---------- */

const scenario = process.env.MAIN_TEST_SCENARIO;
const ud = process.env.MOCK_UD;
const assert = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} [main/${scenario}] ${m}`); if (!c) process.exitCode = 1; };
const done = () => process.exit(process.exitCode || 0);

if (scenario === 'win32') Object.defineProperty(process, 'platform', { value: 'win32' });

const mockPath = path.join(__dirname, 'electron-mock.js');
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return originalLoad.call(this, mockPath, ...rest);
  return originalLoad.call(this, request, ...rest);
};

require(mockPath);
const S = global.__S;
if (scenario === 'fail') S.registerOk = false;
require(path.join(__dirname, '..', 'main.js'));
S.ready();

(function run() {
  const [main, qa] = S.windows;
  if (scenario==='normal') {
    assert(main.file==='index.html' && qa.file==='quickadd.html', 'two windows created');
    assert(main.visible, 'main window shown on normal start');
    assert(!qa.visible, 'quick add hidden initially');
    assert(qa.opts.alwaysOnTop && qa.opts.frame===false && qa.opts.skipTaskbar, 'quick add frameless/on top/no taskbar');
    assert(!!S.shortcuts['CommandOrControl+Alt+K'], 'Ctrl+Alt+K registered');
    assert(S.login && S.login.openAtLogin===true && S.login.args[0]==='--hidden', 'start with Windows registered hidden');
    assert(S.tray && S.tray.tip.includes('Ctrl+Alt+K'), 'tray tooltip: '+S.tray.tip);
    
    const settings=JSON.parse(fs.readFileSync(ud+'/settings.json'));
    assert(settings.startWithWindows===true && settings.quickAddShortcut==='CommandOrControl+Alt+K', 'settings file written');
    // data save so projects are known
    S.handlers['data:save'](null,{version:2,projects:[{id:'p1',name:'Work',color:'#ff0000',collapsed:false}],tasks:[],archive:[]});
    S.shortcuts['CommandOrControl+Alt+K']();
    assert(!qa.visible, 'waits for page to report its size');
    S.on['quickadd:ready'](null, 186);
    assert(qa.visible && qa.bounds.height===186, 'shown at reported height');
    assert(qa.menu===null, 'no app menu in quick add');
    S.on['quickadd:resize'](null, 5000); assert(qa.bounds.height===420, 'height clamped');
    S.on['quickadd:resize'](null, 186);
    const open=qa.webContents.sent.find(s=>s[0]==='quickadd:open');
    assert(open && open[1].projects[0].name==='Work' && open[1].projects[0].color==='#ff0000', 'quick add gets projects');
    assert(qa.bounds.x===1920+Math.round((2560-640)/2) && qa.bounds.y===Math.round(1440*0.22), 'opens on the monitor with the cursor');
    S.on['quickadd:submit'](null,{text:'  Hello  ',projectId:'p1',column:'todo',keepOpen:true});
    const fwd=main.webContents.sent.find(s=>s[0]==='quickadd:task');
    assert(fwd && fwd[1].text==='Hello' && fwd[1].column==='todo' && fwd[1].projectId==='p1', 'task forwarded to main window');
    assert(qa.visible, 'keepOpen keeps box open');
    S.on['quickadd:submit'](null,{text:'Bye',projectId:'p1',column:'weird'});
    assert(main.webContents.sent.filter(s=>s[0]==='quickadd:task')[1][1].column==='pool', 'bad column -> pool');
    assert(!qa.visible, 'Enter closes box');
    S.on['quickadd:submit'](null,{text:'   '}); assert(main.webContents.sent.filter(s=>s[0]==='quickadd:task').length===2, 'empty ignored');
    assert(JSON.parse(fs.readFileSync(ud+'/settings.json')).lastQuickAddProjectId==='p1', 'last project remembered');
    S.shortcuts['CommandOrControl+Alt+K'](); S.on['quickadd:ready'](null,186); qa.emit('blur'); assert(!qa.visible, 'blur hides box');
    S.shortcuts['CommandOrControl+Alt+K'](); S.on['quickadd:ready'](null,186); S.on['quickadd:close'](); assert(!qa.visible, 'Esc hides box');
    // close to tray
    const prevented=main.close();
    assert(prevented && !main.visible, 'closing hides to tray');
    assert(S.balloons.length===1 && S.balloons[0].content.includes('Ctrl+Alt+K'), 'first close shows tray hint');
    main.close(); assert(S.balloons.length===1, 'tray hint only once');
    S.tray.ev.click(); assert(main.visible, 'tray click reopens');
    const trayItems=S.tray.menu.map(i=>i.label);
    assert(trayItems.includes('Quit Todo Kanban') && trayItems.some(l=>l&&l.startsWith('Quick add task')), 'tray menu: '+trayItems.filter(Boolean).join(' | '));
    const sww=S.tray.menu.find(i=>i.label==='Start with Windows'); sww.click({checked:false});
    assert(S.login.openAtLogin===false && JSON.parse(fs.readFileSync(ud+'/settings.json')).startWithWindows===false, 'toggle start with Windows off');
    const file=S.menu.find(m=>m.label==='File').submenu; assert(file.find(i=>i.label==='Start with Windows').checked===false, 'File menu checkbox synced');
    S.appEvents['before-quit'](); const p2=main.close(); assert(!p2, 'quit really closes');
    S.appEvents['will-quit'](); assert(Object.keys(S.shortcuts).length===0, 'shortcut unregistered on quit');
  }
  if (scenario==='hidden') {
    assert(!main.visible, 'hidden start keeps window hidden');
    S.tray.ev.click(); assert(main.visible && main.maximized===false, 'tray click shows window');
  }
  if (scenario==='fail') {
    assert(S.dialogs.length===1 && S.dialogs[0].message.includes("Couldn't set up Ctrl+Alt+K"), 'warns when hotkey taken');
    const file=S.menu.find(m=>m.label==='File').submenu; assert(file[0].label==='Quick add task' && !file[0].accelerator, 'menu still offers quick add');
    file[0].click(); setTimeout(()=>{ assert(qa.visible, 'fallback shows box without ready'); done(); }, 400); return;
  }
  if (scenario==='dev') {
    assert(S.login===null, 'npm start does not register autostart');
  }

  if (scenario === 'win32') {
    assert(S.aumid === 'com.olle.todo-kanban.board', 'own taskbar app id (not the installer shortcut id)');
    assert(main.appDetails && main.appDetails.appId === 'com.olle.todo-kanban.board', 'window app details set');
    assert(main.appDetails.appIconPath.endsWith(path.join('icons', 'todo-kanban-icon-v2.ico')), 'relaunch icon is the copied icon file');
    assert(fs.existsSync(path.join(ud, 'icons', 'todo-kanban-icon-v2.ico')), 'icon copied to the data folder');
    assert(main.opts.icon === main.appDetails.appIconPath && S.tray.icon === main.appDetails.appIconPath, 'window, tray and taskbar share the icon');
  }
  if (scenario === 'data') {
    assert(S.handlers['data:load']() === null, 'no data file yet');
    const d = { version: 2, projects: [{ id: 'a', name: 'W' }], tasks: [{ id: 't', text: 'x', projectId: 'a', column: 'pool' }], archive: [] };
    S.handlers['data:save'](null, d);
    d.tasks.push({ id: 'u', text: 'y', projectId: 'a', column: 'todo' });
    S.handlers['data:save'](null, d);
    assert(S.handlers['data:load']().tasks.length === 2, 'save + load round trip');
    assert(JSON.parse(fs.readFileSync(path.join(ud, 'kanban-data.bak.json'))).tasks.length === 1, 'previous version kept as .bak');
    assert(fs.readdirSync(path.join(ud, 'backups')).length === 1, 'daily backup written');
    let rejected = false;
    try { S.handlers['data:save'](null, { foo: 1 }); } catch { rejected = true; }
    assert(rejected, 'invalid data refused');
    fs.writeFileSync(path.join(ud, 'kanban-data.json'), '{broken');
    assert(S.handlers['data:load']().tasks.length === 1, 'corrupt file falls back to .bak');
  }
  done();
})();
