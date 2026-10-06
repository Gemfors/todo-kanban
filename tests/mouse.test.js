'use strict';
// Mouse-first card actions: W/E on the card under the pointer, and the right-click menu.
const { loadPlaywright, pageUrl, createChecker } = require('./helpers');
const { chromium } = loadPlaywright();
const APP = pageUrl('index.html');
const { check, errors, finish } = createChecker('mouse');

const seed = {
  version: 2,
  projects: [{ id: 'se', name: 'Sales Excellence', color: '#4f46e5', collapsed: false }],
  tasks: [
    { id: 'a', text: 'Atlassian dashboard', projectId: 'se', column: 'pool' },
    { id: 'b', text: 'Följ upp med Niklas hur vi gör med Wests dashboard', projectId: 'se', column: 'pool' },
    { id: 'c', text: 'Fredriks ask kring VCC', projectId: 'se', column: 'todo' },
    { id: 'd', text: 'Slå ihop Toyota', projectId: 'se', column: 'doing' }
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
      onImported: () => {}, onCommand: () => {}, onQuickAdd: () => {}
    };
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.evaluate(data => { localStorage.clear(); localStorage.setItem('__file', JSON.stringify(data)); }, seed);
  await page.reload();
  await page.waitForTimeout(200);

  const card = id => page.locator(`.task-card[data-task-id="${id}"]`);
  const badge = id => card(id).locator('.waiting-badge');
  const column = async id => (await page.evaluate(() => JSON.parse(localStorage.getItem('__file')))).tasks.find(t => t.id === id).column;
  const modalTitle = () => page.locator('.modal-title').innerText().catch(() => null);

  // Hover + W
  await card('b').hover();
  await page.keyboard.press('w');
  check(await modalTitle() === 'Waiting for…', 'pointing at a card and pressing W opens the waiting prompt');
  check(await page.locator('.modal input[type=text]').inputValue() === 'Niklas', '…for the card under the mouse');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  check((await badge('b').innerText()).startsWith('⏳ Niklas'), 'Enter marks it as waiting');
  check(await column('b') === 'pool', 'card did not move');

  // After clicking (and moving) one card, W goes to the card under the mouse, not the clicked one
  await card('a').click();
  await page.waitForTimeout(400);
  check(await column('a') === 'todo', 'single click still moves the card');
  check(await page.evaluate(() => document.activeElement.dataset.taskId) === 'a', 'clicked card has focus');
  await card('d').hover();
  await page.keyboard.press('w');
  check(await page.locator('.modal-task-text').innerText() === 'Slå ihop Toyota', 'W acts on the hovered card, not the focused one');
  await page.keyboard.press('Escape');

  // Hover + E
  await card('c').hover();
  await page.keyboard.press('e');
  check(await modalTitle() === 'Edit task' && await page.locator('.modal-editor input[type=text]').first().inputValue() === 'Fredriks ask kring VCC', 'E opens the editor for the hovered card');
  await page.keyboard.press('Escape');

  // Pointer over nothing: W does nothing
  await page.mouse.move(1250, 60);
  await page.locator('h2').first().click();
  await page.keyboard.press('w');
  check(!(await page.locator('.modal').count()), 'W with no card under the mouse does nothing');

  // Hover + W on a waiting card clears it
  await card('b').hover();
  await page.keyboard.press('w');
  await page.waitForTimeout(50);
  check((await badge('b').count()) === 0, 'W on a waiting card clears it');

  // Right-click menu
  await card('c').click({ button: 'right' });
  await page.waitForTimeout(50);
  check(await page.locator('.context-menu').isVisible(), 'right-click opens the card menu');
  check(await column('c') === 'todo', 'right-click does not move the card');
  const labels = await page.locator('.context-menu-label').allInnerTexts();
  check(JSON.stringify(labels) === JSON.stringify(['⏳ Waiting for…', '✏️ Edit', 'Move to Task Pool', 'Move to Doing', 'Move to Done', 'Delete']), 'menu items: ' + labels.join(' | '));
  await page.keyboard.press('w');
  check(await modalTitle() === 'Waiting for…' && !(await page.locator('.context-menu').count()), 'W inside the menu opens the waiting prompt');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  check((await badge('c').innerText()).startsWith('⏳ Fredrik'), 'marked from the menu');

  await card('c').click({ button: 'right' });
  const waitingLabel = await page.locator('.context-menu-label').first().innerText();
  check(waitingLabel === '⏳ No longer waiting', 'menu offers to clear waiting');
  await page.keyboard.press('Escape');
  check(!(await page.locator('.context-menu').count()), 'Esc closes the menu');

  await card('c').click({ button: 'right' });
  await page.mouse.click(1250, 60);
  check(!(await page.locator('.context-menu').count()), 'clicking elsewhere closes the menu');

  await card('d').click({ button: 'right' });
  await page.locator('.context-menu-item', { hasText: 'Move to Done' }).click();
  await page.waitForTimeout(50);
  check(await column('d') === 'done', 'Move to Done from the menu');

  await card('d').click({ button: 'right' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check(await modalTitle() === 'Edit task', 'arrow keys + Enter pick a menu item');
  await page.keyboard.press('Escape');

  await card('d').click({ button: 'right' });
  await page.locator('.context-menu-item', { hasText: 'Delete' }).click();
  await page.waitForTimeout(50);
  check(!(await card('d').count()) && (await page.locator('.toast-undo').isVisible()), 'Delete from the menu, with Undo');
  await page.click('.toast-undo');
  await page.waitForTimeout(50);
  check((await card('d').count()) === 1, 'undo brings it back');

  // Menu stays inside the window near the edge
  await page.setViewportSize({ width: 900, height: 520 });
  const box = await card('b').boundingBox();
  await page.mouse.click(box.x + box.width - 5, box.y + box.height - 5, { button: 'right' });
  const menuBox = await page.locator('.context-menu').boundingBox();
  check(menuBox.x + menuBox.width <= 900 && menuBox.y + menuBox.height <= 520 && menuBox.y >= 0, 'menu kept inside the window');
  await page.keyboard.press('Escape');

  // Double-click still opens the editor and typing goes into the title (no W shortcut there)
  await card('a').dblclick();
  await page.waitForTimeout(300);
  await page.keyboard.type('w');
  check(await page.locator('.modal-editor input[type=text]').first().inputValue() === 'w', 'typing in the editor is unaffected');
  await page.keyboard.press('Escape');

  await browser.close();
  finish();
})().catch(err => { console.error(err); process.exitCode = 1; });
