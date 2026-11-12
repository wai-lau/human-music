# Lists shipped with the extension (for now)

The service worker imports these files on install, on every reload of the
extension and when Chrome starts, each only when its content changed since
the last import. `index.json` names them.

- `my-lists.json`: your own lists (artists, songs, keywords, never skip),
  settings and filter-list choices, as a Human Music backup. Merged into what
  the extension already has. To update it, export a backup from the popup's
  Lists tab and run `scripts/save-lists.sh`, which copies the newest export
  from Downloads here and commits it.
- `soul-over-ai.json`: a names-only snapshot of the Soul Over AI list
  (souloverai.com, CC BY 4.0), used only while no downloaded copy exists.

Later the package ships without lists and downloads a shipped set of known
lists instead.
