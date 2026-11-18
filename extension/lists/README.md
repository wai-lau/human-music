# Lists shipped with the extension

The service worker imports these files on install, on every reload of the
extension and when Chrome starts, each only when its content changed since
the last import. `index.json` names them.

- `my-lists.json`: your own lists (artists, songs, keywords, never skip),
  settings and filter-list choices, as a Human Music backup. Merged into what
  the extension already has. To update it, export a backup from the popup's
  Lists tab and run `scripts/save-lists.sh`, which copies the newest export
  from Downloads here and commits it.

Built-in lists such as Soul Over AI are downloaded on install, not shipped
with the package.
