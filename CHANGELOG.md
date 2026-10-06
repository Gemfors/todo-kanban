# Changelog

All notable changes to Todo Kanban. Versions follow semantic versioning:
patch = bug fixes, minor = new features, major = changes that break the data format.

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
