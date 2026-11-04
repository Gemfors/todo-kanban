# Changelog

All notable changes to Todo Kanban. Versions follow semantic versioning:
patch = bug fixes, minor = new features, major = changes that break the data format.

## 1.8.1 – 2026-11-04

### Security
- Both windows run sandboxed, with web views turned off and web security explicitly on. Before, the sandbox was only on by default.
- The quick-add window can no longer navigate away or open new windows, the same as the board window already couldn't.
- Camera, microphone, location, notification and other permission requests are refused.
- Messages to the main process are only accepted from the app's own windows. The quick-add window can no longer read the board data.
- Links are opened exactly as they were checked (the normalised http/https address), never the raw text.
- Reload and DevTools are hidden in the installed app (still there with `npm start`).

### Fixed
- File → Start with Windows can now really turn off starting with Windows. An old startup entry from 1.2.0 (from before the taskbar fix) kept starting the app and is now removed.

### Developer
- Playwright is now a dev dependency, so `npm test` runs every suite without extra setup.
- `TODO_KANBAN_DATA_DIR` points a source run (`npm start`, tests) at a scratch data folder. The installed app ignores it.

## 1.8.0 – 2026-10-06

### Added
- Dark mode. The app follows the Windows light/dark setting automatically, and View → Theme lets you force Light or Dark (remembered). It covers the board, Task Pool, dialogs, right-click menus, the archive, messages and the quick-add box. Project colours and tags stay the same, and the important text keeps a high contrast in both themes.

### Changed
- All colours now come from `theme.css` (light and dark tokens). The light theme looks the same as before.
- Windows open with a background matching the theme, so there's no white flash in dark mode.



### Added
- Search on the board: the search field at the top right (or press / or Ctrl+F). Cards that don't match fade out on the Today board and in the Task Pool; it searches the task text, notes, the waiting-for name and the project name/label, and all words must match. A collapsed project opens while it has matches. Enter jumps to the first match, Esc clears.
- Clickable links in notes: cards whose notes contain web links get a 🔗 (with a count if there are several) that opens the first link in your browser; right-click the card for all links. The edit window lists the links under the notes as you type, and archived notes have clickable links too. Only http/https links are opened, and the board window can never navigate away.



### Added
- Done clears itself each morning: tasks finished on an earlier day move to the archive the first time the app starts, wakes up or gets focus on a new day. Today's finished tasks stay. A message with Undo tells you when it happens. Right-click the Done header to clear now, turn it off/on, or open the archive. Clear still works.
- Tasks remember when they were finished (`doneAt`); older ones use their last change as the date.
- New archive view: a search box (text, notes, project name or label), filter chips per project (including deleted projects), and the list grouped by the day each task was finished (Today, Yesterday, weekday + date), newest first, with counts.
- Daily copy of your board in OneDrive: `Dokument\Todo Kanban backups\kanban-YYYY-MM-DD.json`, refreshed at most hourly and when you quit, last 30 days kept. File → "Daily backup to OneDrive" turns it off; File → "Open OneDrive backups folder"; Help → About shows the folder.

### Changed
- The local daily backups are named by your local date instead of UTC.



### Added
- Project tags on Today-board cards: a small tag in the project colour with a short label (LAM, SE, UPP, HCS, AHK, ÖVR…) replaces the colour dot, so you can tell projects apart without relying on colour alone. Hover the tag for the full name. Task Pool cards keep the dot, since they already sit under their project.
  - Labels are automatic: initials for several words, a leading acronym as it is, otherwise the first three letters. Clashes get an extra letter (Sales Enablement next to Sales Excellence → SEN).
  - Text on the tag switches between white and dark depending on the colour.
- Right-click a project header for Rename, Short label…, Change colour and Delete project. Short label sets your own label (up to 5 characters; leave empty for automatic).



### Changed
- W and E now work on the card under the mouse pointer. Before, they needed a card selected with Tab, while a click moves a card and a double-click opens the editor.
- New right-click menu on cards: Waiting for… (W), Edit (E), Move to …, Delete. Arrow keys, Enter and the letter shortcuts work inside it.
- Helper text and the shortcut list explain the mouse options.

## 1.4.0 – 2026-10-06

### Added
- "Waiting for" marks: press W on a card (or hover and click ⏳) to mark that you're waiting on someone. The card gets a dashed outline and a badge like `⏳ Niklas · 3d`; after 7 days the badge turns orange.
  - The name is suggested from the task text ("Följ upp med Niklas…" → Niklas, "Fredriks ask…" → Fredrik) and is optional.
  - W again clears it; the edit dialog also has a "Waiting for someone" checkbox and name.
  - Moving a task to Done ends the wait. The day count updates while the app stays open.
- Automated tests in `tests/` (`npm test`): board, waiting, quick add and main process.

### Changed
- Card layout: the text always gets the full width. Badges (⏳, 📝) sit on a line below it, and the buttons float over the top-right corner on hover.

## 1.3.3 – 2026-10-06

### Fixed
- Taskbar still showed the atom icon: the window now has its own app id (`com.olle.todo-kanban.board`), so Windows no longer matches it to the installer's Start-menu shortcut and the icon cached for it. The icon is copied to the data folder under a new file name and used for the window, the tray and the pinned taskbar item.
- To pin the app, right-click its taskbar button while it's running and choose "Pin to taskbar".

## 1.3.2 – 2026-10-06

### Fixed
- The taskbar showed Electron's default atom icon. The window now tells Windows explicitly to use the kanban icon from the program file, and uses the .ico version of the icon on Windows.
- The program file (Todo Kanban.exe) itself now carries the kanban icon (patched in place; original kept as `Todo Kanban.exe.orig-1.0.0`).

## 1.3.1 – 2026-10-06

### Changed
- The Archive button no longer shows a task count.

## 1.3.0 – 2026-10-06

### Added
- Quick add: choose the project with the keyboard while typing. ↑/↓ (or Tab/Shift+Tab) step through the projects, and Alt+1–9 (or Ctrl+1–9) jump to a numbered one. The projects are shown as numbered chips under the text field, with the selected one highlighted.

### Changed
- The project dropdown in quick add is replaced by the chips; `#name` still works.
- The quick-add box sizes itself to fit your projects and has no app-menu shortcuts inside it.

## 1.2.0 – 2026-10-06

### Added
- Quick add from anywhere: press Ctrl+Alt+K in any program to open a small box, type the task and press Enter.
  - `#name` picks the project by the start of its name, part of it, or its initials (`#sales`, `#upph`, `#lam`).
  - Enter adds to the Task Pool, Ctrl+Enter straight to To Do, Shift+Enter adds and keeps the box open, Esc closes.
  - Remembers the last project used; opens on the monitor where the mouse is.
- Tray icon: click to open the board; the menu has Quick add, Start with Windows and Quit.
- Starts hidden in the tray when you log in to Windows (File → Start with Windows to turn off).
- App icon (window and tray).

### Changed
- Closing the window hides it to the tray so the hotkey keeps working. Quit from the tray menu or with Ctrl+Q.
- The hotkey can be changed with `quickAddShortcut` in `settings.json` in the data folder (Electron accelerator format).

## 1.1.0 – 2026-10-06

### Added
- Clear button in the Done column moves finished tasks to an Archive (restore, delete, empty).
- Notes on tasks: double-click a card (or ✏️) to edit its title, project and notes; 📝 marks cards with notes.
- Undo/redo (Ctrl+Z / Ctrl+Y, 50 steps) and an Undo button after deletes.
- Keyboard shortcuts: N new task, P new project, ? help, and Enter/←/→/↑/↓/E/Delete on a selected card.
- Data saved to `kanban-data.json` in the app data folder, with a previous-version `.bak` and 14 daily backups.
- File menu: Export backup, Import backup, Open data folder. Help → About shows the version.
- Version number shown in the title bar.

### Fixed
- Renaming a project no longer disconnects its tasks on the Today board (wrong colour, returning to the wrong project).
- Deleting a project asks for confirmation, also removes its board tasks, and can be undone.
- Event listeners were attached several times when projects were added.
- Changing a project colour re-rendered mid-pick.
- The window could reopen off-screen after a monitor change.
- Two running copies could overwrite each other's data (single-instance lock).

### Changed
- Data moved from browser localStorage to a JSON file (migrated automatically on first start).
- A single click waits ~0.2 s before moving a card so a double-click can open the editor.
- ✏️ on a card opens the edit dialog instead of renaming inline.
- Electron security: context isolation on, Node integration off (preload bridge).

## 1.0.1
- Last version before the rewrite (source in `Software/_archive/todo-kanban-src-2026-10-06`).

## 1.0.0 – 2026-03-16
- First installed version.
