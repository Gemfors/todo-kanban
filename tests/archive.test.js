'use strict';
// Auto-clear of Done each morning, and the archive view (search, project filter, days).
const { loadPlaywright, pageUrl, createChecker } = require('./helpers');
const { chromium } = loadPlaywright();
const APP = pageUrl('index.html');
const { check, errors, finish } = createChecker('archive');

const NOW = new Date(2026, 9, 7, 8, 30); // Wed 7 Oct 2026, 08:30 local time
const at = (day, hour = 12) => new Date(2026, 9, day, hour).toISOString();

const seed = {
  version: 2,
  projects: [
    { id: 'lam', name: 'Large Accounts Management', color: '#cd2323' },
    { id: 'se', name: 'Sales Excellence', color: '#4f46e5' }
  ],
  tasks: [
    { id: 'd1', text: 'Done yesterday', projectId: 'lam', column: 'done', doneAt: at(6, 15) },
    { id: 'd2', text: 'Done this morning', projectId: 'se', column: 'done', doneAt: at(7, 7) },
    { id: 'd3', text: 'Old done without date', projectId: 'se', column: 'done', updatedAt: at(5) },
    { id: 't1', text: 'Still to do', projectId: 'se', column: 'todo' }
  ],
  archive: [
    { id: 'a1', text: 'Kickoff with Martin', projectId: 'lam', projectName: 'Large Accounts Management', doneAt: at(6, 10), archivedAt: at(6, 18) },
    { id: 'a2', text: 'Sales dashboard v1', projectId: 'se', projectName: 'Sales Excellence', archivedAt: at(1) },
    { id: 'a3', text: 'Review offer', notes: 'budget questions', projectId: 'gone', projectName: 'Old proj', doneAt: new Date(2026, 8, 30, 9).toISOString(), archivedAt: at(1) }
  ]
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await context.addInitScript(() => {
    window.kanbanStorage = {
      load: async () => { const s = localStorage.getItem('__file'); return s ? JSON.parse(s) : null; },
      save: async d => { localStorage.setItem('__file', JSON.stringify(d)); return true; },
      onImported: () => {}, onCommand: cb => { window.__command = cb; }, onQuickAdd: () => {}
    };
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: NOW });
  await page.goto(APP);
  await page.evaluate(data => { localStorage.clear(); localStorage.setItem('__file', JSON.stringify(data)); }, seed);
  await page.reload();
  await page.waitForTimeout(200);

  const doneIds = () => page.locator('.column[data-column="done"] .task-card').evaluateAll(cards => cards.map(c => c.dataset.taskId));
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('__file')));
  const blank = () => page.locator('h2').first().click();
  const focusWindow = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));

  // --- Auto-clear on start ---
  check(JSON.stringify(await doneIds()) === JSON.stringify(['d2']), 'on a new day, earlier finished tasks leave Done: ' + await doneIds());
  check((await page.locator('#toast').innerText()).includes('archived 2 tasks'), 'toast tells what happened');
  let data = await saved();
  check(['d1', 'd3'].every(id => data.archive.some(a => a.id === id)), 'they are in the archive');
  check(data.archive.find(a => a.id === 'd1').doneAt === at(6, 15), 'archive keeps when it was finished');

  await page.click('.toast-undo');
  await page.waitForTimeout(50);
  check((await doneIds()).length === 3, 'Undo puts them back');
  await focusWindow();
  await page.waitForTimeout(50);
  check((await doneIds()).length === 3, 'not cleared again the same day after Undo');

  // --- doneAt bookkeeping ---
  await page.locator('.task-card[data-task-id="t1"]').focus();
  await page.keyboard.press('ArrowRight'); // todo -> doing
  await page.keyboard.press('ArrowRight'); // doing -> done
  await page.waitForTimeout(50);
  data = await saved();
  const t1 = data.tasks.find(t => t.id === 't1');
  check(t1.column === 'done' && Math.abs(new Date(t1.doneAt) - NOW) < 60000, 'moving to Done records the time');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(50);
  check((await saved()).tasks.find(t => t.id === 't1').doneAt === null, 'moving out of Done clears it');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(50);

  // --- Next morning (app left open in the tray) ---
  await page.clock.fastForward('24:00:00');
  await page.waitForTimeout(100);
  check((await doneIds()).length === 0, 'next morning everything finished before today is archived');

  // --- Done header menu: turn auto-clear off ---
  await page.locator('.column[data-column="done"] .column-header').click({ button: 'right' });
  let labels = await page.locator('.context-menu-label').allInnerTexts();
  check(labels.includes('☑ Clear each morning automatically') && labels.includes('Open archive'), 'Done header menu: ' + labels.join(' | '));
  await page.locator('.context-menu-item', { hasText: 'Clear each morning' }).click();
  await page.waitForTimeout(50);
  check((await saved()).settings.autoClearDone === false, 'auto-clear can be turned off (saved)');

  // Finish a new task today, then let a day pass: with auto-clear off it stays in Done
  const input = page.locator('.project-section[data-project-id="se"] .project-task-input');
  await input.fill('Fresh task');
  await input.press('Enter');
  await page.waitForTimeout(50);
  const fresh = page.locator('.task-card', { hasText: 'Fresh task' });
  await fresh.focus();
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(30); }
  check(JSON.stringify(await page.locator('.column[data-column="done"] .task-text').allInnerTexts()) === JSON.stringify(['Fresh task']), 'new task finished');
  await page.clock.fastForward('24:00:00');
  await focusWindow();
  await page.waitForTimeout(50);
  check((await page.locator('.column[data-column="done"] .task-text').allInnerTexts()).includes('Fresh task'), 'with auto-clear off it stays in Done the next day');
  await page.locator('.column[data-column="done"] .column-header').click({ button: 'right' });
  labels = await page.locator('.context-menu-label').allInnerTexts();
  check(labels.includes('☐ Clear each morning automatically') && labels.includes('Clear now (1)'), 'menu shows it is off and offers Clear now');
  await page.locator('.context-menu-item', { hasText: 'Clear each morning' }).click();
  await page.waitForTimeout(50);
  check((await saved()).settings.autoClearDone === true && (await page.locator('.column[data-column="done"] .task-card').count()) === 0, 'turning it back on clears the old ones right away');

  // --- Archive view ---
  await page.click('#archive-button');
  await page.waitForTimeout(50);
  check(await page.evaluate(() => document.activeElement.classList.contains('archive-search')), 'search field focused when the archive opens');
  const days = await page.locator('.archive-day > span:first-child').allInnerTexts();
  check(days.length >= 3 && new Set(days).size === days.length, 'grouped by day: ' + days.join(' | '));
  const items = await page.locator('.archive-text').allInnerTexts();
  check(items.indexOf('Kickoff with Martin') < items.indexOf('Sales dashboard v1') && items.indexOf('Sales dashboard v1') < items.indexOf('Review offer'), 'newest first, old entries without a done date use their archive date');
  check((await page.locator('.archive-day-count').first().innerText()).includes('task'), 'each day shows a count');
  check((await page.locator('.archive-item .project-tag').first().innerText()).length > 0, 'rows show the project tag');

  // Search
  await page.keyboard.type('budget');
  await page.waitForTimeout(50);
  check(JSON.stringify(await page.locator('.archive-text').allInnerTexts()) === JSON.stringify(['Review offer']), 'search finds notes');
  check(await page.evaluate(() => document.activeElement.classList.contains('archive-search')), 'search field keeps focus while typing');
  check((await page.locator('.archive-total').innerText()).startsWith('1 of'), 'footer shows how many match');
  await page.fill('.archive-search', 'lam');
  await page.waitForTimeout(50);
  const lamItems = await page.locator('.archive-text').allInnerTexts();
  check(lamItems.includes('Kickoff with Martin') && lamItems.includes('Done yesterday') && !lamItems.includes('Sales dashboard v1'), 'search by project label');
  await page.fill('.archive-search', 'zzzz');
  check(await page.locator('.archive-empty').isVisible(), 'no matches message');
  await page.fill('.archive-search', '');

  // Project filter
  const filters = await page.locator('.archive-filter').allInnerTexts();
  check(filters[0] === 'All projects' && filters.includes('LAM') && filters.includes('SE') && filters.includes('OP'), 'filter chips incl. a deleted project: ' + filters.join(' | '));
  await page.locator('.archive-filter', { hasText: 'LAM' }).click();
  let shown = await page.locator('.archive-text').allInnerTexts();
  check(shown.length > 0 && shown.every(t => ['Kickoff with Martin', 'Done yesterday'].includes(t)), 'filter shows one project');
  await page.locator('.archive-filter', { hasText: 'LAM' }).click();
  check((await page.locator('.archive-text').count()) === (await saved()).archive.length, 'clicking it again shows all');
  await page.locator('.archive-filter', { hasText: 'OP' }).click();
  check(JSON.stringify(await page.locator('.archive-text').allInnerTexts()) === JSON.stringify(['Review offer']), 'filter on a deleted project');

  // Restore with a filter active
  await page.locator('.archive-item button', { hasText: 'Restore' }).click();
  await page.waitForTimeout(50);
  check(!(await saved()).archive.some(a => a.id === 'a3'), 'restored from the filtered view');
  check(await page.locator('.archive-filter.selected').innerText() === 'All projects', 'filter resets when that project has nothing left');
  await page.keyboard.press('Escape');
  check(!(await page.locator('.modal').count()), 'Esc closes the archive');

  await browser.close();
  finish();
})().catch(err => { console.error(err); process.exitCode = 1; });
