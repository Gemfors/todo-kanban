# Tests

Run all with `npm test` (or `node tests/run-all.js --verbose` for every check).

- `archive.test.js` – auto-clear of Done each morning, the Done header menu, the archive view (search, project filter, days).
- `board.test.js` – board window: migration from the old storage, moving cards, editor and notes, project rename/delete, archive, undo/redo, keyboard shortcuts, drag and drop, load errors.
- `search-links.test.js` – search on the board, 🔗 links on cards, in the editor and in the archive.
- `theme.test.js` – light/dark colours and contrast of key text in the board, dialogs, menus and quick add.
- `waiting.test.js` – "Waiting for" marks, plus tasks arriving from quick add.
- `mouse.test.js` – W/E on the card under the mouse, the right-click menu.
- `quickadd.test.js` – the quick-add box: project chips, ↑↓ / Alt+1–9, #tags, Enter variants.
- `labels.test.js` – project tags on board cards, automatic/custom short labels, the project header menu.
- `main.test.js` – main process against a mocked Electron (`electron-mock.js`): hotkey, quick-add window, tray, close-to-tray, start with Windows, data file and backups, taskbar identity, OneDrive backup copies, links, theme setting, and the security hardening (sandbox, navigation and permission blocking, IPC sender checks, startup entries).

The browser tests use Playwright with Chromium (a dev dependency). After `npm install`, run
`npx playwright install chromium` once.
