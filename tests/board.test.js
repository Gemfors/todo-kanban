'use strict';
// Board window: migration, moves, editing, rename/delete projects, archive, undo, shortcuts, drag and drop.
const { loadPlaywright, pageUrl, createChecker } = require('./helpers');
const { chromium } = loadPlaywright();
const APP = pageUrl('index.html');
const { check, errors, finish } = createChecker('board');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  // Stub of the Electron preload bridge; persists to localStorage key __file so reloads work.
  await ctx.addInitScript(() => {
    window.__saves = 0;
    window.kanbanStorage = {
      load: async () => { const s = localStorage.getItem('__file'); return s ? JSON.parse(s) : null; },
      save: async (d) => { window.__saves++; localStorage.setItem('__file', JSON.stringify(d)); return true; },
      onImported: (cb) => { window.__import = cb; },
      onCommand: (cb) => { window.__command = cb; }
    };
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // Seed legacy data (old localStorage format), including a board task whose project was renamed (the old bug)
  await page.goto(APP);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('projects', JSON.stringify([
      { name: 'Work', collapsed: false, color: '#ff0000' },
      { name: 'Presentations', collapsed: false, color: '#00aa00' }]));
    localStorage.setItem('tasks', JSON.stringify([
      { text: 'Pool A', column: 'pool', project: 'Work' },
      { text: 'Pool B', column: 'pool', project: 'Presentations' },
      { text: 'Todo C', column: 'todo', project: 'Presentations' },
      { text: 'Done D', column: 'done', project: 'Work' },
      { text: 'Orphan E', column: 'doing', project: 'Old name' }]));
  });
  await page.reload();
  await page.waitForTimeout(300);

  const text = sel => page.locator(sel).allInnerTexts();
  const col = c => page.locator(`.column[data-column="${c}"] .task-text`).allInnerTexts();
  const pool = name => page.locator('.project-section', { has: page.locator('h3', { hasText: name }) }).locator('.task-text').allInnerTexts();
  const card = t => page.locator('.task-card', { hasText: t });

  check((await col('todo')).join() === 'Todo C', 'migrated todo column');
  check((await col('doing')).join() === 'Orphan E', 'migrated orphan task kept');
  check((await page.locator('.project-section h3').count()) === 3, 'orphan project recreated (3 projects)');
  check(await page.evaluate(() => !!localStorage.getItem('__file')), 'saved to data file');
  check(await page.locator('#toast').isVisible(), 'migration toast shown');

  // Single click moves after delay
  await card('Pool A').click();
  await page.waitForTimeout(400);
  check((await col('todo')).includes('Pool A'), 'click moves pool -> todo');

  // Double click opens editor without moving
  await card('Todo C').dblclick();
  await page.waitForTimeout(400);
  check(await page.locator('.modal-editor').isVisible(), 'dblclick opens editor');
  check((await col('todo')).includes('Todo C'), 'dblclick does not move card');
  await page.fill('.modal-editor textarea', 'Some notes\nline 2');
  await page.fill('.modal-editor input[type=text]', 'Todo C renamed');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(100);
  check(!(await page.locator('.modal').count()), 'editor closed on Ctrl+Enter');
  check((await card('Todo C renamed').locator('.notes-indicator').count()) === 1, 'notes indicator shown');

  // Rename project Presentations -> Slides; board card keeps colour
  const pres = page.locator('.project-section', { has: page.locator('h3', { hasText: 'Presentations' }) });
  await pres.hover();
  await pres.locator('.rename-project-button').click();
  await page.fill('.rename-project-input', 'Slides');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const dot = await card('Todo C renamed').locator('.project-tag').evaluate(e => getComputedStyle(e).backgroundColor);
  check(dot === 'rgb(0, 170, 0)', 'board card keeps project colour after rename: ' + dot);
  // Move Todo C through to done and back to pool -> should land in Slides
  for (let i = 0; i < 3; i++) { await card('Todo C renamed').click(); await page.waitForTimeout(350); }
  check((await pool('Slides')).includes('Todo C renamed'), 'card returns to renamed project');

  // Add task in Slides, should get Slides' colour
  const sl = page.locator('.project-section', { has: page.locator('h3', { hasText: 'Slides' }) });
  await sl.locator('.project-task-input').fill('New slide task');
  await sl.locator('.project-task-input').press('Enter');
  await page.waitForTimeout(100);
  check((await pool('Slides')).includes('New slide task'), 'task added to renamed project');
  check(await page.evaluate(() => document.activeElement.classList.contains('project-task-input')), 'focus stays in input after adding');
  check((await page.locator('.task-card', { hasText: 'New slide task' }).count()) === 1, 'no duplicate cards');

  // Clear done -> archive
  check(await page.locator('#clear-done-button').isVisible(), 'Clear button visible with done tasks');
  await page.click('#clear-done-button');
  await page.waitForTimeout(100);
  check((await col('done')).length === 0, 'done cleared');
  check((await page.locator('#archive-button').innerText()) === 'Archive', 'archive button without count');
  await page.click('#archive-button');
  check((await text('.archive-text')).join() === 'Done D', 'archive lists task');
  await page.locator('.archive-item button', { hasText: 'Restore' }).click();
  await page.waitForTimeout(100);
  check((await pool('Work')).includes('Done D'), 'restore to project pool');
  await page.keyboard.press('Escape');
  check(!(await page.locator('.modal').count()), 'Esc closes archive');

  // Delete project with a board task, confirm, then undo
  await card('Pool B').click(); await page.waitForTimeout(350); // Pool B -> todo
  const slides = page.locator('.project-section', { has: page.locator('h3', { hasText: 'Slides' }) });
  await slides.hover();
  await slides.locator('.delete-project-button').click();
  check(await page.locator('.modal-small .button-danger').isVisible(), 'delete project asks for confirmation');
  check((await page.locator('.modal-text').innerText()).includes('1 on the Today board'), 'confirmation mentions board task');
  await page.locator('.modal-small .button-danger').click();
  await page.waitForTimeout(100);
  check(!(await col('todo')).includes('Pool B'), 'board tasks of deleted project removed');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check((await col('todo')).includes('Pool B') && (await pool('Slides')).length === 2, 'Ctrl+Z restores project and tasks');

  // Keyboard: N then type
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('n');
  await page.keyboard.type('Keyboard task');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check(await page.locator('.task-card', { hasText: 'Keyboard task' }).count() === 1, 'N + typing adds task');
  check(!(await page.locator('.task-card', { hasText: 'nKeyboard' }).count()), 'N not typed into input');
  // Esc leaves input, card keyboard nav
  await page.keyboard.press('Escape');
  await card('Keyboard task').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check((await col('todo')).includes('Keyboard task'), 'Enter on focused card moves it');
  check(await page.evaluate(() => document.activeElement.textContent.includes('Keyboard task')), 'focus follows moved card');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  check((await col('doing')).includes('Keyboard task'), 'ArrowRight moves to doing');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  check((await col('todo')).includes('Keyboard task'), 'ArrowLeft moves back');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  check(!(await page.locator('.task-card', { hasText: 'Keyboard task' }).count()), 'Delete key deletes');
  check((await page.locator('.toast-undo').isVisible()), 'undo toast after delete');
  await page.click('.toast-undo');
  await page.waitForTimeout(100);
  check(await page.locator('.task-card', { hasText: 'Keyboard task' }).count() === 1, 'toast Undo restores');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(100);
  check(!(await page.locator('.task-card', { hasText: 'Keyboard task' }).count()), 'Ctrl+Y redoes delete');
  await page.keyboard.press('?');
  check(await page.locator('.shortcut-table').isVisible(), '? shows shortcuts');
  await page.keyboard.press('Escape');

  // Drag and drop: Pool A (todo) -> Doing ; Pool B (todo) -> Work project (changes project)
  await card('Pool A').dragTo(page.locator('.column[data-column="doing"]'));
  await page.waitForTimeout(150);
  check((await col('doing')).includes('Pool A'), 'drag todo -> doing');
  await card('Pool B').dragTo(page.locator('.project-section', { has: page.locator('h3', { hasText: 'Work' }) }));
  await page.waitForTimeout(150);
  check((await pool('Work')).includes('Pool B'), 'drag to other project');
  const bDot = await card('Pool B').locator('.task-color-dot').evaluate(e => getComputedStyle(e).backgroundColor);
  check(bDot === 'rgb(255, 0, 0)', 'dragged card takes new project colour');
  // drag ordering within todo: put Orphan E (doing) above Pool A? use doing column ordering
  await card('Orphan E').dragTo(card('Pool A'), { targetPosition: { x: 20, y: 2 } });
  await page.waitForTimeout(150);
  check((await col('doing')).join() === 'Orphan E,Pool A', 'drop ordering respected: ' + (await col('doing')).join());

  // Collapse project
  await page.locator('.project-section h3', { hasText: 'Work' }).click();
  check(await page.locator('.project-section.collapsed').count() === 1, 'collapse');

  // Import via bridge
  await page.evaluate(() => window.__import({ projects: [{ name: 'Imported' }], tasks: [{ text: 'Imp 1', column: 'todo', project: 'Imported' }] }));
  await page.waitForTimeout(100);
  check((await col('todo')).join() === 'Imp 1', 'import replaces board');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  check((await page.locator('.project-section').count()) === 3, 'undo import');

  // Persistence across reload
  const before = await page.locator('.task-text').allInnerTexts();
  await page.reload();
  await page.waitForTimeout(300);
  const after = await page.locator('.task-text').allInnerTexts();
  check(JSON.stringify(before) === JSON.stringify(after), 'state persists across reload');
  await page.locator('.project-section h3', { hasText: 'Work' }).click(); // expand
  await card('Todo C renamed').hover();
  await card('Todo C renamed').dblclick();
  await page.waitForTimeout(300);

  // Load error -> saving blocked
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => { window.kanbanStorage.load = async () => { throw new Error('disk on fire'); }; });
  await p2.goto(APP); await p2.waitForTimeout(300);
  check((await p2.locator('#toast').innerText()).includes('saving is turned off'), 'load error blocks saving');
  const fileStill = await p2.evaluate(() => JSON.parse(localStorage.getItem('__file')).tasks.length);
  check(fileStill === after.length, 'data file untouched after load error');

  await browser.close();
  finish();
})();
