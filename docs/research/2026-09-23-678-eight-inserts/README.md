# Eight-insert editor verification — #678

Run `node docs/research/2026-09-23-678-eight-inserts/collect.mjs` with Node 24
and local Chrome after rebuilding the standalone editor.

The script opens a song with two inserts on a track and on Master, enables
audio, adds up to eight on each, verifies Add is disabled at eight, reorders
the chorus, removes/re-adds an effect, plays an Init note through both chains,
and exports/re-imports all sixteen inserts. `browser.json` identifies the
machine, backend, page hash and resulting card order. `editor.png` shows the
controls; `console.json` and `network.json` are the complete listings.

These are functional checks on a development machine, not CPU benchmarks.
Existing tests cover editor additions, normalisation and live excess-entry
reporting against the shared limit. `build-size.json` records the production
client delta against the unmodified worktree baseline.
