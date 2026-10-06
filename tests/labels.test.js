'use strict';
// Project short labels: coloured tags on Today-board cards, the project header menu and label dialog.
const { loadPlaywright, pageUrl, createChecker } = require('./helpers');
const { chromium } = loadPlaywright();
const APP = pageUrl('index.html');
const { check, errors, finish } = createChecker('labels');

const seed = {
  version: 2,
  projects: [
    { id: 'lam', name: 'Large Accounts Management', color: '#cd2323' },
    { id: 'se', name: 'Sales Excellence', color: '#4f46e5' },
    { id: 'up', name: 'Upphandlingar', color: '#019d9b' },
    { id: 'hub', name: 'HubSpot/Cinode/Sana', color: '#e6e04c' },
    { id: 'ahk', name: 'AHK & Macros', color: '#8e0189' },
    { id: 'ovr', name: 'Övrigt', color: '#737373' },
    { id: 'sen', name: 'Sales Enablement', color: '#0ea5e9' }
  ],
  tasks: [
    { id: 't1', text: 'Snacka med Martin om nästa våg', projectId: 'lam', column: 'todo' },
    { id: 't2', text: 'Atlassian dashboard', projectId: 'se', column: 'doing' },
    { id: 't3', text: 'OP Uppdatera Excel-svaren', projectId: 'up', column: 'done' },
    { id: 't4', text: 'Testa Teams-integrationen?', projectId: 'hub', column: 'todo' },
    { id: 't5', text: 'Paketering av min toolbar', projectId: 'ahk', column: 'todo' },
    { id: 't6', text: 'Lägg in Armins targets', projectId: 'ovr', column: 'todo' },
    { id: 't7', text: 'Enablement deck', projectId: 'sen', column: 'todo' },
    { id: 't8', text: 'Sales planning prep', projectId: 'se', column: 'pool' }
  ],
  archive: []
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
  const tag = id => card(id).locator('.project-tag');
  const tagText = id => tag(id).innerText();
  const header = id => page.locator(`.project-section[data-project-id="${id}"] .project-header-row`);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('__file')));
  const openHeaderMenu = async id => {
    await header(id).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await header(id).click({ button: 'right' });
  };

  // Automatic labels
  const expected = { t1: 'LAM', t2: 'SE', t3: 'UPP', t4: 'HCS', t5: 'AHK', t6: 'ÖVR', t7: 'SEN' };
  for (const [id, label] of Object.entries(expected)) {
    check(await tagText(id) === label, `${id} shows ${label} (got ${await tagText(id)})`);
  }
  check(await tag('t1').getAttribute('title') === 'Large Accounts Management', 'tag tooltip shows the full name');
  check(await tag('t1').evaluate(t => getComputedStyle(t).backgroundColor) === 'rgb(205, 35, 35)', 'tag uses the project colour');
  check(await tag('t4').evaluate(t => getComputedStyle(t).color) === 'rgb(31, 41, 51)', 'dark text on the yellow project');
  check(await tag('t1').evaluate(t => getComputedStyle(t).color) === 'rgb(255, 255, 255)', 'white text on the red project');
  check((await tag('t8').count()) === 0 && (await card('t8').locator('.task-color-dot').count()) === 1, 'Task Pool cards keep the colour dot');
  check((await card('t1').locator('.task-color-dot').count()) === 0, 'board cards show the tag instead of the dot');

  // Moving between pool and board switches dot <-> tag
  await card('t8').click();
  await page.waitForTimeout(400);
  check(await tagText('t8') === 'SE', 'card moved onto the board gets its tag');

  // Project header right-click menu
  await openHeaderMenu('lam');
  const labels = await page.locator('.context-menu-label').allInnerTexts();
  check(JSON.stringify(labels) === JSON.stringify(['✏️ Rename', '🏷️ Short label (LAM)…', '🎨 Change colour', 'Delete project…']), 'project menu: ' + labels.join(' | '));
  await page.locator('.context-menu-item', { hasText: 'Short label' }).click();
  check((await page.locator('.modal-title').innerText()).includes('Large Accounts Management'), 'label dialog opens');
  const input = page.locator('.modal input[type=text]');
  check(await input.getAttribute('placeholder') === 'LAM' && await input.inputValue() === '', 'automatic label shown as placeholder');
  await input.fill('KAM');
  check(await page.locator('.project-tag-preview').innerText() === 'KAM', 'preview updates while typing');
  await input.press('Enter');
  await page.waitForTimeout(50);
  check(await tagText('t1') === 'KAM', 'custom label shows on cards');
  check((await saved()).projects.find(p => p.id === 'lam').shortLabel === 'KAM', 'custom label saved');
  check((await page.locator('#toast').innerText()).includes('KAM'), 'toast confirms');

  await page.locator('h2').first().click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(50);
  check(await tagText('t1') === 'LAM', 'undo restores the automatic label');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(50);

  // Long input is cut to 5 characters; empty goes back to automatic
  await openHeaderMenu('lam');
  await page.locator('.context-menu-item', { hasText: 'Short label' }).click();
  check(await input.inputValue() === 'KAM', 'dialog shows the current custom label');
  await input.fill('');
  await input.press('Enter');
  await page.waitForTimeout(50);
  check(await tagText('t1') === 'LAM' && (await saved()).projects.find(p => p.id === 'lam').shortLabel === '', 'empty label = automatic again');

  // Custom label that clashes with an automatic one: the automatic one makes room
  await openHeaderMenu('ovr');
  await page.locator('.context-menu-item', { hasText: 'Short label' }).click();
  await input.fill('SE');
  await input.press('Enter');
  await page.waitForTimeout(50);
  check(await tagText('t6') === 'SE' && await tagText('t2') !== 'SE', `custom label wins, automatic one changes (Sales Excellence → ${await tagText('t2')})`);

  // Rename from the menu: automatic label follows the new name
  await openHeaderMenu('ahk');
  await page.locator('.context-menu-item', { hasText: 'Rename' }).click();
  await page.locator('.rename-project-input').fill('Scripting Tools');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(50);
  check(await tagText('t5') === 'ST', 'rename updates the automatic label');

  // Change colour from the menu: picking repaints the tags
  await openHeaderMenu('se');
  await page.locator('.context-menu-item', { hasText: 'Change colour' }).click();
  await page.evaluate(() => {
    const picker = document.querySelector('.project-section[data-project-id="se"] .project-color-picker');
    picker.value = '#fde047';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(50);
  check(await tag('t2').evaluate(t => getComputedStyle(t).backgroundColor) === 'rgb(253, 224, 71)', 'new colour on the tag');
  check(await tag('t2').evaluate(t => getComputedStyle(t).color) === 'rgb(31, 41, 51)', 'text switches to dark on a light colour');

  // Delete from the project menu still confirms
  await openHeaderMenu('sen');
  await page.locator('.context-menu-item', { hasText: 'Delete project' }).click();
  check(await page.locator('.modal .button-danger').isVisible(), 'delete from the menu asks first');
  await page.keyboard.press('Escape');

  // Labels survive a restart
  await page.reload();
  await page.waitForTimeout(200);
  check(await tagText('t6') === 'SE', 'custom label survives restart');

  await browser.close();
  finish();
})().catch(err => { console.error(err); process.exitCode = 1; });
