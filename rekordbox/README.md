# Rekordbox / FLUX Database Layer

- `rekordbox/database.py` + `rekordbox/models.py` — Python `RekordboxDatabase` (pyrekordbox, encrypted Rekordbox DB)
- `../flux-db.js` — browser `FluxDatabase` mirroring the same API (IndexedDB), with Rekordbox XML import/export

FLUX loads `flux-db.js` from `index.html`; data lives in IndexedDB `flux-dj-db`.
