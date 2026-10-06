'use strict';
// Light and dark theme: colours follow prefers-color-scheme (set by Electron's nativeTheme),
// and the important text/background pairs stay readable in both.
const { loadPlaywright, pageUrl, createChecker } = require('./helpers');
const { chromium } = loadPlaywright();
const APP = pageUrl('index.html');
const QA = pageUrl('quickadd.html');
const { check, errors, finish } = createChecker('theme');

const seed = {
  version: 2,
  projects: [{ id: 'se', name: 'Sales Excellence', color: '#4f46e5' }, { id: 'hub', name: 'HubSpot', color: '#e6e04c' }],
  tasks: [
    { id: 't1', text: 'Waiting card', projectId: 'se', column: 'todo', waitingFor: { who: 'Niklas', since: new Date(Date.now() - 9 * 864e5).toISOString() } },
    { id: 't2', text: 'Linked card', projectId: 'hub', column: 'doing', notes: 'https://example.com' },
    { id: 't3', text: 'Pool card', projectId: 'se', column: 'pool' }
  ],
  archive: []
};

// WCAG contrast ratio between two CSS colours, computed in the page.
const CONTRAST = `
  window.__contrast = (fg, bg) => {
    const parse = c => { const m = c.match(/[\\d.]+/g).map(Number); return m.slice(0, 3); };
    const lum = rgb => { const [r, g, b] = rgb.map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const a = lum(parse(fg)), b = lum(parse(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };`;

async function openBoard(browser, colorScheme) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme });
  await context.addInitScript(() => {
    window.kanbanStorage = {
      load: async () => { const s = localStorage.getItem('__file'); return s ? JSON.parse(s) : null; },
      save: async d => { localStorage.setItem('__file', JSON.stringify(d)); return true; },
      onImported: () => {}, onCommand: () => {}, onQuickAdd: () => {}, openExternal: async () => true
    };
  });
  await context.addInitScript(CONTRAST);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP);
  await page.evaluate(data => { localStorage.clear(); localStorage.setItem('__file', JSON.stringify(data)); }, seed);
  await page.reload();
  await page.waitForTimeout(200);
  return page;
}

const style = (page, selector, prop) => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
const contrast = (page, fg, bg) => page.evaluate(([a, b]) => window.__contrast(a, b), [fg, bg]);

(async () => {
  const browser = await chromium.launch();

  /* ---------- Light (unchanged look) ---------- */
  const light = await openBoard(browser, 'light');
  check(await style(light, 'body', 'backgroundColor') === 'rgb(246, 247, 251)', 'light: page background as before');
  check(await style(light, '.task-card[data-task-id="t2"]', 'backgroundColor') === 'rgb(255, 255, 255)', 'light: white cards');
  check(await style(light, 'body', 'color') === 'rgb(31, 41, 51)', 'light: dark text');

  /* ---------- Dark ---------- */
  const dark = await openBoard(browser, 'dark');
  const bodyBg = await style(dark, 'body', 'backgroundColor');
  const cardBg = await style(dark, '.task-card[data-task-id="t2"]', 'backgroundColor');
  const text = await style(dark, '.task-card[data-task-id="t2"] .task-text', 'color');
  check(await contrast(dark, await style(dark, '.task-card[data-task-id="t1"] .task-text', 'color'), await style(dark, '.task-card[data-task-id="t1"]', 'backgroundColor')) >= 7, 'dark: waiting card text readable');
  check(bodyBg === 'rgb(21, 24, 29)', 'dark: page background ' + bodyBg);
  check(cardBg === 'rgb(29, 33, 40)', 'dark: card background ' + cardBg);
  check(await contrast(dark, text, cardBg) >= 7, 'dark: card text very readable');
  check(await contrast(dark, await style(dark, '.helper-text', 'color'), await style(dark, '.top-area', 'backgroundColor')) >= 4.5, 'dark: helper text readable');
  check(await contrast(dark, await style(dark, '.column-count', 'color'), await style(dark, '.column', 'backgroundColor')) >= 4.5, 'dark: counts readable');
  check(await contrast(dark, await style(dark, '.waiting-badge', 'color'), await style(dark, '.waiting-badge', 'backgroundColor')) >= 4.5, 'dark: stale waiting badge readable');
  check(await contrast(dark, await style(dark, '.project-section h3', 'color'), await style(dark, '.project-section', 'backgroundColor')) >= 7, 'dark: project headings readable');
  check(await style(dark, '.project-task-input', 'backgroundColor') !== 'rgb(255, 255, 255)', 'dark: inputs are dark too');
  check(await contrast(dark, await style(dark, '.project-task-input', 'color'), await style(dark, '.project-task-input', 'backgroundColor')) >= 7, 'dark: input text readable');
  check(await contrast(dark, await style(dark, '#archive-button', 'color'), await style(dark, '#archive-button', 'backgroundColor')) >= 4.5, 'dark: buttons readable');
  const hubTag = dark.locator('.task-card[data-task-id="t2"] .project-tag');
  check(await contrast(dark, await hubTag.evaluate(t => getComputedStyle(t).color), await hubTag.evaluate(t => getComputedStyle(t).backgroundColor)) >= 4.5, 'dark: project tags keep readable text');

  // Dialogs, menus and the archive
  await dark.locator('.task-card[data-task-id="t2"]').dblclick();
  await dark.waitForTimeout(300);
  const modalBg = await style(dark, '.modal', 'backgroundColor');
  check(modalBg === cardBg, 'dark: dialog background');
  check(await contrast(dark, await style(dark, '.modal-editor textarea', 'color'), await style(dark, '.modal-editor textarea', 'backgroundColor')) >= 7, 'dark: notes field readable');
  check(await contrast(dark, await style(dark, '.editor-links .note-link', 'color'), modalBg) >= 4.5, 'dark: links readable');
  check(await contrast(dark, await style(dark, '.button-primary', 'color'), await style(dark, '.button-primary', 'backgroundColor')) >= 4.4, 'dark: primary button readable');
  check(await contrast(dark, await style(dark, '.button-danger-subtle', 'color'), modalBg) >= 4.5, 'dark: delete button readable');
  await dark.keyboard.press('Escape');

  await dark.locator('.task-card[data-task-id="t1"]').click({ button: 'right' });
  const menuBg = await style(dark, '.context-menu', 'backgroundColor');
  check(menuBg === cardBg && await contrast(dark, await style(dark, '.context-menu-item', 'color'), menuBg) >= 7, 'dark: right-click menu');
  await dark.keyboard.press('Escape');

  await dark.click('#archive-button');
  check(await contrast(dark, await style(dark, '.modal-text', 'color'), await style(dark, '.modal', 'backgroundColor')) >= 4.5, 'dark: archive text readable');
  await dark.keyboard.press('Escape');

  // Toast and search
  await dark.locator('.task-card[data-task-id="t3"]').hover();
  await dark.keyboard.press('w');
  await dark.keyboard.press('Enter');
  check(await contrast(dark, await style(dark, '#toast', 'color'), await style(dark, '#toast', 'backgroundColor')) >= 4.5, 'dark: toast readable');
  await dark.fill('#board-search', 'linked');
  check(await style(dark, '#board-search', 'backgroundColor') !== 'rgb(255, 255, 255)', 'dark: search field dark');

  /* ---------- Quick add box ---------- */
  const qaContext = await browser.newContext({ viewport: { width: 640, height: 190 }, colorScheme: 'dark' });
  await qaContext.addInitScript(CONTRAST);
  const qa = await qaContext.newPage();
  qa.on('pageerror', e => errors.push(e.message));
  await qa.goto(QA);
  await qa.evaluate(() => window.__quickAddOpen({ projects: [{ id: 'a', name: 'Sales', color: '#4f46e5' }, { id: 'b', name: 'HubSpot', color: '#e6e04c' }], lastProjectId: 'a' }));
  await qa.waitForTimeout(200);
  const qaBg = await style(qa, 'body', 'backgroundColor');
  check(qaBg === 'rgb(29, 33, 40)', 'dark: quick-add background ' + qaBg);
  check(await contrast(qa, await style(qa, '#qa-text', 'color'), await style(qa, '#qa-text', 'backgroundColor')) >= 7, 'dark: quick-add text readable');
  check(await contrast(qa, await style(qa, '.qa-chip', 'color'), await style(qa, '.qa-chip', 'backgroundColor')) >= 4.5, 'dark: project chips readable');
  check(await contrast(qa, await style(qa, '.qa-chip.selected', 'color'), await style(qa, '.qa-chip.selected', 'backgroundColor')) >= 4.5, 'dark: selected chip readable');
  check(await contrast(qa, await style(qa, '.qa-hint', 'color'), qaBg) >= 4.5, 'dark: hints readable');

  await browser.close();
  finish();
})().catch(err => { console.error(err); process.exitCode = 1; });
