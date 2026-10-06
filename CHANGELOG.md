# Changelog

All notable changes to Todo Kanban. Versions follow semantic versioning:
patch = bug fixes, minor = new features, major = changes that break the data format.

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
