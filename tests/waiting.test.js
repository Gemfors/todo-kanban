'use strict';
// "Waiting for" marks on cards, plus tasks arriving from quick add.
const { loadPlaywright, pageUrl, createChecker } = require('./helpers');
const { chromium } = loadPlaywright();
const APP = pageUrl('index.html');
const { check, errors, finish } = createChecker('waiting');

const NOW = new Date('2026-10-06T09:00:00');
const daysAgo = n => new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();

const seed = {
  version: 2,
  projects: [
    { id: 'se', name: 'Sales Excellence', color: '#4f46e5', collapsed: false },
    { id: 'ovr', name: 'Övrigt', color: '#737373', collapsed: false }
  ],
  tasks: [
    { id: 't1', text: 'Följ upp med Niklas hur vi gör med Wests dashboard', projectId: 'se', column: 'pool', waitingFor: { who: 'Niklas', since: daysAgo(10) } },
    { id: 't2', text: 'Väntar på offert', projectId: 'se', column: 'doing', waitingFor: { who: '', since: daysAgo(0) } },
    { id: 't3', text: 'Följ upp med Victor uppföljningen av Ericsson lending', projectId: 'ovr', column: 'pool' },
    { id: 't4', text: 'Fredriks ask kring VCC', projectId: 'se', column: 'todo' },
    { id: 't5', text: 'Broken waiting value', projectId: 'se', column: 'pool', waitingFor: 'yes' }
  ],
  archive: []
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await context.addInitScript(() => {
    window.kanbanStorage = {
      load: async () => { const s = localStorage.getItem('__file'); return s ? JSON.parse(s) : null; },
      save: async d => { localStorage.setItem('__file', JSON.stringify(d)); return true; },
      onImported: () => {},
      onCommand: () => {},
      onQuickAdd: cb => { window.__quickAdd = cb; }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: NOW });

  await page.goto(APP);
  await page.evaluate(data => { localStorage.clear(); localStorage.setItem('__file', JSON.stringify(data)); }, seed);
  await page.reload();
  await page.waitForTimeout(200);

  const card = id => page.locator(`.task-card[data-task-id="${id}"]`);
  const badge = id => card(id).locator('.waiting-badge');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('__file')));
  const savedTask = async id => (await saved()).tasks.find(t => t.id === id);
  const blank = () => page.locator('body').click({ position: { x: 5, y: 5 } });

  // Display
  check((await badge('t1').innerText()) === '⏳ Niklas · 10d', 'badge shows name and days: ' + await badge('t1').innerText());
  check(await badge('t1').evaluate(b => b.classList.contains('stale')), 'waiting 7+ days is highlighted');
  check(await card('t1').evaluate(c => c.classList.contains('is-waiting')), 'waiting card styled');
  check((await badge('t2').innerText()) === '⏳ today', 'no name, started today');
  check(!(await badge('t2').evaluate(b => b.classList.contains('stale'))), 'fresh wait not highlighted');
  check((await badge('t3').count()) === 0, 'normal card has no badge');
  check((await badge('t5').count()) === 0 && (await savedTask('t5')).waitingFor === null, 'invalid stored value ignored');

  // W on a focused card: prompt with a suggested name
  await card('t3').focus();
  await page.keyboard.press('w');
  check(await page.locator('.modal-title', { hasText: 'Waiting for' }).isVisible(), 'W opens waiting prompt');
  check(await page.locator('.modal input[type=text]').inputValue() === 'Victor', 'name suggested from task text');
  await page.keyboard.type('Victor S');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  check((await badge('t3').innerText()) === '⏳ Victor S · today', 'marked waiting with typed name');
  check((await page.locator('#toast').innerText()).includes('Waiting for Victor S'), 'toast confirms');
  let t3 = await savedTask('t3');
  check(t3.waitingFor && t3.waitingFor.who === 'Victor S' && Math.abs(new Date(t3.waitingFor.since) - NOW) < 60000, 'saved with since date');
  check(await page.evaluate(() => document.activeElement.dataset.taskId) === 't3', 'focus back on the card');

  // W again clears; Ctrl+Z restores
  await page.keyboard.press('w');
  await page.waitForTimeout(50);
  check((await badge('t3').count()) === 0 && (await savedTask('t3')).waitingFor === null, 'W again clears waiting');
  await blank();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(50);
  check((await badge('t3').innerText()) === '⏳ Victor S · today', 'undo restores waiting');

  // Possessive suggestion + Esc cancels
  await card('t4').focus();
  await page.keyboard.press('w');
  check(await page.locator('.modal input[type=text]').inputValue() === 'Fredrik', 'suggests Fredrik from "Fredriks ask"');
  await page.keyboard.press('Escape');
  check((await badge('t4').count()) === 0 && !(await page.locator('.modal').count()), 'Esc cancels');

  // Mouse: hover button
  await card('t4').hover();
  await card('t4').locator('.waiting-button').click();
  await page.locator('.modal .button-primary').click();
  await page.waitForTimeout(50);
  check((await badge('t4').innerText()) === '⏳ Fredrik · today', '⏳ button marks waiting');

  // Editor: rename keeps the original date, unchecking clears
  await card('t1').dblclick();
  await page.waitForTimeout(300);
  const checkbox = page.locator('.modal-editor input[type=checkbox]');
  const nameInput = page.locator('.modal-editor .waiting-row input[type=text]');
  check(await checkbox.isChecked() && await nameInput.inputValue() === 'Niklas', 'editor shows waiting state');
  check((await page.locator('.modal-editor .field-hint').innerText()).includes('10 d'), 'editor shows how long');
  await nameInput.fill('Niklas W');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(50);
  const t1 = await savedTask('t1');
  check(t1.waitingFor.who === 'Niklas W' && t1.waitingFor.since === daysAgo(10), 'rename in editor keeps since date');
  await card('t1').dblclick();
  await page.waitForTimeout(300);
  await checkbox.uncheck();
  check(await nameInput.isDisabled(), 'name field disabled when unchecked');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(50);
  check((await savedTask('t1')).waitingFor === null && (await badge('t1').count()) === 0, 'unchecking in editor clears');
  await card('t3').dblclick();
  await page.waitForTimeout(300);
  await page.locator('.modal-editor textarea').fill('note');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(50);
  t3 = await savedTask('t3');
  check(t3.waitingFor && t3.waitingFor.who === 'Victor S', 'editing other fields keeps waiting');

  // Finishing a task ends the wait
  await card('t2').focus();
  await page.keyboard.press('Enter'); // doing -> done
  await page.waitForTimeout(50);
  check((await page.locator('.column[data-column="done"] .task-card[data-task-id="t2"]').count()) === 1, 'moved to Done');
  check((await badge('t2').count()) === 0 && (await savedTask('t2')).waitingFor === null, 'Done clears waiting');
  await blank();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(50);
  check((await badge('t2').innerText()) === '⏳ today', 'undo brings back waiting');

  // Day counter moves on while the app stays open
  await page.clock.fastForward('25:00:00');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  check((await badge('t2').innerText()) === '⏳ 1d', 'counter updates the next day: ' + await badge('t2').innerText());

  // Shortcut list mentions W
  await blank();
  await page.keyboard.press('?');
  check((await page.locator('.shortcut-table').innerText()).includes('waiting'), 'shortcut list documents W');
  await page.keyboard.press('Escape');

  // Quick add lands on the board
  await page.evaluate(() => window.__quickAdd({ text: 'From hotkey', projectId: 'ovr', column: 'pool' }));
  await page.evaluate(() => window.__quickAdd({ text: 'Straight to today', projectId: 'missing', column: 'todo' }));
  await page.waitForTimeout(50);
  const ovrPool = await page.locator('.project-section[data-project-id="ovr"] .task-text').allInnerTexts();
  check(ovrPool.includes('From hotkey'), 'quick add lands in the chosen project');
  check((await page.locator('.column[data-column="todo"] .task-text').allInnerTexts()).includes('Straight to today'), 'quick add to To Do, unknown project falls back');
  await blank();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(50);
  check(!(await page.locator('.task-text', { hasText: 'Straight to today' }).count()), 'quick add can be undone');

  // Survives a reload
  await page.reload();
  await page.waitForTimeout(200);
  check((await badge('t3').innerText()).startsWith('⏳ Victor S'), 'waiting survives restart');

  await browser.close();
  finish();
})().catch(err => { console.error(err); process.exitCode = 1; });
