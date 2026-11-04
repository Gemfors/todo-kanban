# Todo Kanban

A personal Windows desktop kanban app built with Electron and vanilla JavaScript (no framework).

- **Today board**: To Do → Doing → Done.
- **Task Pool**: one column per project.
- **Quick add from anywhere**: press Ctrl+Alt+K in any program.
- **Tray, archive and backups**: the app lives in the tray, finished tasks go to an archive, and the data has daily local and OneDrive backups.
- **Waiting-for marks, search and dark mode.**

See [CHANGELOG.md](CHANGELOG.md) for everything that's been added in each version.

## Project layout

| File | What it is |
|---|---|
| `main.js` | Electron main process: windows, tray, menus, global hotkey, settings, data file and backups, IPC |
| `preload.js` | Exposes `window.kanbanStorage` (load/save/commands/links) to the board window |
| `index.html`, `script.js`, `styles.css` | The board window (renderer): state, rendering, drag and drop, dialogs, archive, undo/redo |
| `quickadd.html`, `quickadd.js`, `quickadd.css`, `quickadd-preload.js` | The global quick-add box |
| `theme.css` | Light and dark colour tokens used by every window |
| `assets/` | App, window and tray icons |
| `tests/` | Automated tests (see [tests/README.md](tests/README.md)) |

## Running and building

```bash
npm install
npm start        # run from source
npm test         # run all test suites (browser tests need Playwright + Chromium)
npm run dist     # build the NSIS installer and app.asar into dist/
```

## Data

The app stores everything under `%APPDATA%\todo-kanban\`:

- **Board data:** `kanban-data.json`, with a `.bak` copy and 14 daily backups in `backups\`.
- **Settings:** `settings.json`.
- **OneDrive copies:** daily copies go to `Documents\Todo Kanban backups\` in OneDrive.

None of this data is in the repository.
