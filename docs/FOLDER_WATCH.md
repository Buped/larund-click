# Folder Watch

Folder watch automations are an event-trigger MVP for local-file workflows.

Current implementation:

- automation trigger type: `{ kind: 'folder_watch', path, pattern }`
- glob-like filename pattern matching with `*` and `?`
- debounce per automation and file path
- trigger payload includes watched path and file path

The current cross-platform layer is a testable trigger shim (`triggerFolderWatch`) rather than a native filesystem watcher. This keeps the interface stable while avoiding platform-specific watcher edge cases in the Phase 3 MVP.

Expected future native implementation:

- Tauri/Rust watcher per enabled folder automation
- permission check for watched folders
- DocumentReference attachment for the new file
- evidence entry showing the file was read

Users can pause folder-watch automations from the Automations tab.
