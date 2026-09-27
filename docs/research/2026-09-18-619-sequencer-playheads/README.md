# #619 — the three sequencer cards' playheads in the built console

A documented browser check, not a gate (`npm run verify` is the gate; ADR
`2026-09-06-browser-specs-are-a-tool-not-a-gate`). It confirms the wiring the
unit tests cannot see: that the one `watchPlayhead` loop in `stepStrip.ts`
actually runs in a browser, that each card's ring lands on a column of its own
strip, and that all three follow the transport.

- **Page**: `tools/patch-editor/patch-editor.html` as rebuilt in this PR, opened
  from `file://` in Chrome (Chrome DevTools MCP, macOS, 2026-09-18).
- **Document**: a new song with three parts re-kinded on the Parts tab — part 1
  `grid` (16 steps, 1/16), part 2 `chord` (four steps, base step 1 bar), part 3
  `euclidean` (n 16, 1/16, `lfoBars` density) — then **Enable audio**, which
  starts the transport at 120 bpm.

## What was read back

Sampling the lit column of each strip every 250 ms, straight after enabling:

| sample | grid | chord | Euclidean |
|---|---|---|---|
| 0 ms | 14 | 2 | 14 |
| 250 ms | 0 | 0 | 0 |
| 500 ms | 2 | 0 | 2 |
| 750 ms | 4 | 0 | 4 |
| 1000 ms | 6 | 0 | 6 |
| 1250 ms | 8 | 0 | 8 |

At 120 bpm a 1/16 step is 125 ms, so the grid and Euclidean rings advancing
**two columns per 250 ms** is the transport's own rate, and the two strips
agreeing column for column is what a playhead read from the absolute tick looks
like (a free-running per-card counter would drift apart). The chord card's base
step is a bar — 2 s — so it holds step 0 across five samples.

Exactly one column is lit per strip at every sample, and the Euclidean ring
moves over the lit onsets of the figure the player holds (`k 8 / n 16` at the
time of the capture: cells 0, 2, 4 …).

That the lit step **is the sounding one** is proved in
`packages/client/src/audio/arrangementPlayerStepAt.test.ts`, not here: every
note a grid part sounds over four bars lands on `stepAt`'s column, and the cards
call `host.stepAt` with no arithmetic of their own.

## Console

One error, the known and handled one: `Unsafe attempt to load URL … 'file:'
URLs are treated as unique security origins` — the blob worklet module a
`file://` origin refuses, after which `EngineHost.enable` retries with data
URLs (`tools/patch-editor/src/host.ts`) and the engine starts. Nothing else.

## Screenshots

- `grid-card.png` — part 1's step columns with the playhead.
- `chord-card.png` — part 2's progression, its picker and the playhead.
- `euclidean-card-fullpage.png` — the whole tab, so the Euclidean figure strip
  and the two cards above it are in one frame.
