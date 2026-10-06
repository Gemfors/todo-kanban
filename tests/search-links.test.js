'use strict';
// Board search (/ or Ctrl+F) and clickable links in notes.
const { loadPlaywright, pageUrl, createChecker } = require('./helpers');
const { chromium } = loadPlaywright();
const APP = pageUrl('index.html');
const { check, errors, finish } = createChecker('search+links');

const seed = {
  version: 2,
  projects: [
    { id: 'lam', name: 'Large Accounts Management', color: '#cd2323' },
    { id: 'se', name: 'Sales Excellence', color: '#4f46e5' },
    { id: 'up', name: 'Upphandlingar', color: '#019d9b', collapsed: true }
  ],
  tasks: [
    { id: 't1', text: 'Snacka med Martin om nästa våg', projectId: 'lam', column: 'todo',
      notes: 'Deck: https://hiq.sharepoint.com/sites/sales/Deck.pptx and (see https://app.hubspot.com/contacts/123).' },
    { id: 't2', text: 'Atlassian dashboard', projectId: 'se', column: 'doing', notes: 'ask about licences' },
    { id: 't3', text: 'Följ upp med Niklas', projectId: 'se', column: 'pool', waitingFor: { who: 'Niklas', since: new Date().toISOString() } },
    { id: 't4', text: 'OP kolla executive summary', projectId: 'up', column: 'pool', notes: 'javascript:alert(1) is not a link' },
    { id: 't5', text: 'Sales planning prep', projectId: 'se', column: 'pool' }
  ],
  archive: [
    { id: 'a1', text: 'Old deck', projectId: 'se', notes: 'Final: https://example.com/final', archivedAt: new Date().toISOString() }
  ]
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(() => {
    window.__opened = [];
    window.kanbanStorage = {
      load: async () => { const s = localStorage.getItem('__file'); return s ? JSON.parse(s) : null; },
      save: async d => { localStorage.setItem('__file', JSON.stringify(d)); return true; },
      onImported: () => {}, onCommand: () => {}, onQuickAdd: () => {},
      openExternal: async url => { window.__opened.push(url); return true; }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.evaluate(data => { localStorage.clear(); localStorage.setItem('__file', JSON.stringify(data)); }, seed);
  await page.reload();
  await page.waitForTimeout(200);

  const card = id => page.locator(`.task-card[data-task-id="${id}"]`);
  const hits = () => page.locator('.task-card.search-hit').evaluateAll(cards => cards.map(c => c.dataset.taskId).sort());
  const misses = () => page.locator('.task-card.search-miss').count();
  const opened = () => page.evaluate(() => window.__opened);
  const column = async id => (await page.evaluate(() => JSON.parse(localStorage.getItem('__file')))).tasks.find(t => t.id === id).column;
  const blank = () => page.locator('h2').first().click();

  /* ---------- Search ---------- */
  await blank();
  await page.keyboard.press('/');
  check(await page.evaluate(() => document.activeElement.id) === 'board-search', '/ focuses the search field');
  await page.keyboard.type('martin');
  check(JSON.stringify(await hits()) === JSON.stringify(['t1']), 'text match');
  check(await misses() === 4, 'other cards fade out');
  check(await page.locator('#board-search-count').innerText() === '1 match', 'match count shown');

  await page.fill('#board-search', 'licences');
  check(JSON.stringify(await hits()) === JSON.stringify(['t2']), 'searches notes');
  await page.fill('#board-search', 'niklas');
  check(JSON.stringify(await hits()) === JSON.stringify(['t3']), 'searches the waiting-for name / pool cards');
  await page.fill('#board-search', 'lam');
  check(JSON.stringify(await hits()) === JSON.stringify(['t1']), 'searches the project label');
  await page.fill('#board-search', 'sales prep');
  check(JSON.stringify(await hits()) === JSON.stringify(['t5']), 'several words must all match');
  await page.fill('#board-search', 'executive');
  check(JSON.stringify(await hits()) === JSON.stringify(['t4']) && await card('t4').isVisible(), 'collapsed project opens to show a match');
  await page.fill('#board-search', 'zzzz');
  check(await page.locator('.board-search.no-hits').count() === 1 && await page.locator('#board-search-count').innerText() === '0 matches', 'no matches is shown');

  await page.fill('#board-search', 'atlassian');
  await page.keyboard.press('Enter');
  check(await page.evaluate(() => document.activeElement.dataset.taskId) === 't2', 'Enter jumps to the first match');
  await page.keyboard.press('ArrowRight'); // doing -> done, re-renders the board
  await page.waitForTimeout(50);
  check(JSON.stringify(await hits()) === JSON.stringify(['t2']) && await misses() === 4, 'search stays applied after a change');
  await page.keyboard.press('ArrowLeft');

  await page.locator('#board-search').focus();
  await page.keyboard.press('Escape');
  check(await page.inputValue('#board-search') === '' && await misses() === 0 && !(await card('t4').isVisible()), 'Esc clears the search (and the collapsed project closes again)');
  check(await page.evaluate(() => document.activeElement.id) !== 'board-search', 'Esc leaves the field');

  await card('t5').click(); // single click moves it, focus on a card
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+f');
  check(await page.evaluate(() => document.activeElement.id) === 'board-search', 'Ctrl+F focuses the search field');
  await page.keyboard.press('Escape');

  /* ---------- Links on cards ---------- */
  const linkButton = card('t1').locator('.link-button');
  check(await linkButton.isVisible() && (await linkButton.innerText()) === '🔗 2', 'card shows 🔗 with the number of links');
  check((await card('t2').locator('.link-button').count()) === 0 && (await card('t4').locator('.link-button').count()) === 0, 'no 🔗 without web links (javascript: ignored)');
  await linkButton.click();
  await page.waitForTimeout(300);
  check(JSON.stringify(await opened()) === JSON.stringify(['https://hiq.sharepoint.com/sites/sales/Deck.pptx']), 'click opens the first link');
  check(await column('t1') === 'todo', 'clicking 🔗 does not move the card');
  check(!(await page.locator('.modal').count()), 'clicking 🔗 does not open the editor');

  await card('t1').click({ button: 'right' });
  const labels = await page.locator('.context-menu-label').allInnerTexts();
  check(labels.includes('🔗 hiq.sharepoint.com/sites/sales/Deck.pptx') && labels.includes('🔗 app.hubspot.com/contacts/123'), 'right-click menu lists the links: ' + labels.filter(l => l.startsWith('🔗')).join(' | '));
  await page.locator('.context-menu-item', { hasText: 'hubspot' }).click();
  check((await opened())[1] === 'https://app.hubspot.com/contacts/123', 'menu opens that link; trailing ")." trimmed');

  /* ---------- Links in the editor ---------- */
  await card('t1').dblclick();
  await page.waitForTimeout(300);
  check((await page.locator('.editor-links .note-link').count()) === 2, 'editor lists the links under the notes');
  await page.locator('.editor-links .note-link').nth(1).click();
  check((await opened())[2] === 'https://app.hubspot.com/contacts/123', 'editor link opens');
  await page.locator('.modal-editor textarea').fill('New: https://teams.microsoft.com/l/meetup-join/xyz');
  check((await page.locator('.editor-links .note-link').allInnerTexts()).join() === '🔗 teams.microsoft.com/l/meetup-join/xyz', 'list updates while typing');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(50);
  check((await card('t1').locator('.link-button').innerText()) === '🔗', 'saved notes update the card');

  /* ---------- Links in the archive ---------- */
  await page.click('#archive-button');
  await page.locator('.archive-notes .note-link').click();
  check((await opened()).includes('https://example.com/final'), 'archive notes have clickable links');
  await page.keyboard.press('Escape');

  /* ---------- Shortcut list ---------- */
  await blank();
  await page.keyboard.press('?');
  check((await page.locator('.shortcut-table').innerText()).includes('Search the board'), 'shortcut list mentions search');

  await browser.close();
  finish();
})().catch(err => { console.error(err); process.exitCode = 1; });
