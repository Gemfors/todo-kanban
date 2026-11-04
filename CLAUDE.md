# Notes for Claude

This is Olle's personal Todo Kanban app: Electron, vanilla JS, no framework. Olle runs the **installed** app all day, not `npm start`. See README.md for the file layout and CHANGELOG.md for the history.

## Release procedure (Claude owns versioning and releases)

1. **Change and test.** Make the change and run `npm test`. All suites must pass, and new features get tests.
2. **Version and changelog.** Bump the version in `package.json` with semver: patch = fix, minor = feature, major = breaking data-format change. Add a CHANGELOG entry with a `## x.y.z – YYYY-MM-DD` heading.
3. **Commit, tag and push.** Commit as `Release x.y.z: <summary>`, tag `vx.y.z`, then `git push --follow-tags`.
4. **Build the app code.** Run `npm run dist` and copy `dist/win-unpacked/resources/app.asar` to `..\todo-kanban-releases\<version>\app.asar`. Add a row to the README table in that folder.
5. **Install.** Ask Olle to **quit** the app first (tray → Quit, or Ctrl+Q; the X only hides it to the tray). Then copy the asar to `%LOCALAPPDATA%\Programs\Todo Kanban\resources\app.asar`, and ask Olle to start the app and check.

- **Rollback:** copy an older release's `app.asar` back into the install folder.
- **When a new installer is needed:** only for a new Electron version or new installer settings. Windows' app list still says 1.0.0 because of this.
- **Exe icon:** `Todo Kanban.exe` in the install folder was icon-patched. The original is kept next to it as `Todo Kanban.exe.orig-1.0.0`.

## Olle's preferences

- **Mouse first on the board.** A click moves a card one step and a double-click edits it. Card actions use the card under the pointer (W/E) or the right-click menu, never a "selected" card.
- **Keyboard-only where typing anyway:** quick add and search.
- **Separate, flexible cards rather than nesting.** Checklists, a weekly summary and a Doing limit were all rejected.
- **Suggest, then build.** Propose features one at a time with concrete options and let Olle choose before building.
- **Ctrl+Alt+K** was chosen because it is free in Olle's AutoHotkey scripts.

## Open ideas (not decided)

- Change the quick-add hotkey from inside the app (today it's `quickAddShortcut` in settings.json).
- Show short project labels on the quick-add chips.
- Set "waiting for" from quick add, and add an overview of everything being waited on.
- Rebuild the installer so Windows shows the real version.

## Gotchas

- **Single-instance lock.** Two running instances would overwrite each other's data file.
- **Taskbar app id.** The window uses `com.olle.todo-kanban.board`, deliberately different from the installer appId, so the taskbar shows the kanban icon.
- **Old data migration.** Data from before 1.1 lived in renderer localStorage. `readLegacyLocalStorage` in `script.js` still migrates it.
- **Playwright for tests.** Playwright is a dev dependency; run `npx playwright install chromium` once after `npm install`.
- **Never touch the real data from a source run.** `npm start` uses the same data folder as the installed app (`%APPDATA%\todo-kanban`). Set `TODO_KANBAN_DATA_DIR` to a scratch folder for manual or Playwright-driven runs. The `APPDATA` variable does **not** redirect Electron.
- **Security baseline (1.8.1).** Windows are sandboxed and locked down (`SECURE_WEB_PREFERENCES`, `lockDownWindow`), every IPC handler checks its sender (`isFrom`), and all permissions are denied. New windows and new IPC channels must follow the same pattern.
