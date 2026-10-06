'use strict';
// Quick-add box: project chips, keyboard selection, #tags, submit variants.
const { loadPlaywright, pageUrl, createChecker } = require('./helpers');
const { chromium } = loadPlaywright();
const QA = pageUrl('quickadd.html');
const { check, errors, finish } = createChecker('quickadd');
const projects = [
  { id: 'lam', name: 'Large Accounts Management', color: '#cd2323' },
  { id: 'se', name: 'Sales Excellence', color: '#4f46e5' },
  { id: 'up', name: 'Upphandlingar', color: '#019d9b' },
  { id: 'hub', name: 'HubSpot/Cinode/Sana', color: '#e6e04c' },
  { id: 'ahk', name: 'AHK & Macros', color: '#8e0189' },
  { id: 'ovr', name: 'Övrigt', color: '#737373' }];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 150 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__submits = []; window.__closed = 0; window.__ready = []; window.__resize = [];
    window.quickAdd = { onOpen: cb => { window.__open = cb; }, ready: h => window.__ready.push(h), resize: h => window.__resize.push(h),
      submit: t => window.__submits.push(t), close: () => window.__closed++ };
  });
  await page.goto(QA);
  const open = last => page.evaluate(([p, l]) => window.__open({ projects: p, lastProjectId: l }), [projects, last]);
  const selected = () => page.$eval('.qa-chip.selected', c => c.dataset.projectId).catch(() => null);
  const submits = () => page.evaluate(() => window.__submits);

  await open('up');
  await page.waitForTimeout(100);
  check((await page.locator('.qa-chip').count()) === 6, '6 project chips');
  check(await selected() === 'up', 'last project preselected');
  const h = await page.evaluate(() => window.__ready[0]);
  check(h > 90 && h < 250, 'reports height for window: ' + h);
  await page.setViewportSize({ width: 640, height: h });

  await page.keyboard.type('Ring Martin');
  await page.keyboard.press('ArrowDown');
  check(await selected() === 'hub', '↓ next project');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  check(await selected() === 'se', '↑ previous project');
  await page.keyboard.press('Tab');
  check(await selected() === 'up', 'Tab next');
  await page.keyboard.press('Shift+Tab');
  check(await selected() === 'se', 'Shift+Tab previous');
  check(await page.evaluate(() => document.activeElement.id) === 'qa-text', 'focus stays in text field');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  check(await selected() === 'ovr', 'wraps around at the start');
  await page.keyboard.press('Alt+1');
  check(await selected() === 'lam', 'Alt+1 selects first');
  await page.keyboard.press('Control+5');
  check(await selected() === 'ahk', 'Ctrl+5 selects fifth');
  await page.keyboard.press('Alt+9');
  check(await selected() === 'ahk', 'Alt+9 with no 9th project does nothing');
  check(await page.inputValue('#qa-text') === 'Ring Martin', 'text untouched by project keys');
  await page.keyboard.press('Control+Alt+2'); // AltGr+2 on Swedish keyboards -> must not switch project
  check(await selected() === 'ahk', 'Ctrl+Alt+digit (AltGr) ignored');
  await page.keyboard.press('Alt+3');
  await page.keyboard.press('Enter');
  let s = await submits();
  check(JSON.stringify(s[0]) === JSON.stringify({ text: 'Ring Martin', projectId: 'up', column: 'pool', keepOpen: false }), 'Enter submits with chosen project');

  await open('up');
  await page.keyboard.type('Möte #lam imorgon');
  check(await selected() === 'lam', '#tag still works and highlights chip');
  await page.keyboard.press('ArrowDown');
  check(await selected() === 'se' && await page.inputValue('#qa-text') === 'Möte imorgon', 'arrow after tag removes tag and moves on');
  await page.keyboard.press('Control+Enter');
  s = await submits();
  check(s[1].projectId === 'se' && s[1].column === 'todo' && s[1].text === 'Möte imorgon', 'Ctrl+Enter to To Do');

  await open('se');
  check(await selected() === 'se', 'remembers last project on reopen');
  await page.keyboard.type('A'); await page.keyboard.press('Alt+6'); await page.keyboard.press('Shift+Enter');
  check((await page.locator('#qa-status').innerText()).includes('Added to Övrigt'), 'add another confirms');
  check(await selected() === 'ovr', 'project stays chosen for next task');
  await page.keyboard.type('B'); await page.keyboard.press('Enter');
  s = await submits();
  check(s[2].projectId === 'ovr' && s[3].projectId === 'ovr' && s[3].text === 'B', 'second task same project');

  await open('se');
  await page.locator('.qa-chip').nth(1).click(); await page.locator('.qa-chip').nth(3).click();
  check(await selected() === 'hub' && await page.evaluate(() => document.activeElement.id) === 'qa-text', 'mouse click on chip still works, focus kept');

  await page.keyboard.type('Bad #zzz');
  check((await page.locator('#qa-status').innerText()).includes('No project matches'), 'unknown tag warns');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => window.__closed) === 1, 'Esc closes');

  // typing # (Shift+3) and @ via AltGr shouldn't be eaten
  await open('se');
  await page.keyboard.type('mail ola@hiq.se #3');
  check(await page.inputValue('#qa-text') === 'mail ola@hiq.se #3', 'normal typing incl. @ and # unaffected');

  // many projects: wraps, resize reported
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, name: 'Project with a long name ' + i, color: '#555555' }));
  await page.evaluate(m => window.__open({ projects: m, lastProjectId: 'p0' }), many);
  await page.waitForTimeout(100);
  const h2 = await page.evaluate(() => window.__ready[window.__ready.length - 1]);
  check(h2 > h, 'taller box when chips wrap: ' + h2);
  check((await page.locator('.qa-chip-key').nth(10).innerText()) === '·', 'only 1–9 numbered');

  await browser.close();
  finish();
})();
