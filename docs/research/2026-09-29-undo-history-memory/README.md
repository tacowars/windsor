# What 100 undo steps hold in memory (windsor#124)

The undo history keeps the whole normalised document as it was before each
step. `DocumentModel.merge` builds a fresh document on every change, so a
step shares nothing with the next one. Decision 7 of windsor#124 asks for
the heap growth for 100 recorded knob-sized steps on the largest song in
the repo, measured rather than assumed. This note is that measurement.

## Where and how

- **Machine:** Apple M1, 16 GB, macOS 26.5.1.
- **Runtime:** Node v24.21.0 (darwin arm64), under Vitest 4.1.11 in one
  forked process started with `--expose-gc`.
- **Script:** `measure.test.ts`, run with this folder's config:
  `npx vitest run --config docs/research/2026-09-29-undo-history-memory/vitest.config.ts`.
  Raw numbers: `results.json`.

Each run opens an `AppContext` over a fake host that accepts every change,
makes 100 knob-sized changes through `ctx.change` (each one step), forces
two garbage collections and reads `heapUsed`. Then it clears the history
through `importDoc`, collects again and reads `heapUsed` again. The
difference is what the 100 steps held. There is one warm-up, then seven
runs; the table gives the median.

## The songs

- **`FULL_DOCUMENT`** (`__fixtures__/fullArrangement.ts`): four parts, four
  embedded library patches, a two-event harmony timeline. It is the largest
  song in the repo that loads: the audition songs under `docs/research/`
  are format version 2, which the normaliser no longer reads.
- **Eight parts:** `FULL_DOCUMENT` with four Init parts added through
  `addPartChange`, which is the most parts a song can hold, each with its
  own patch. It is an upper bound for a song without inserts.

## Results

| Song | Knob | Document JSON | Held by 100 steps | Per step |
|---|---|---|---|---|
| `FULL_DOCUMENT` | strip level | 25.3 kB | 2.04 MB | 20.4 kB |
| `FULL_DOCUMENT` | patch volume | 25.3 kB | 2.04 MB | 20.4 kB |
| Eight parts | strip level | 46.7 kB | 3.84 MB | 38.4 kB |
| Eight parts | patch volume | 46.7 kB | 3.89 MB | 38.9 kB |

The runs agree within 3 % of each other in every row. What kind of knob
it is doesn't matter, since every step holds a whole document. A step
costs about 0.8 times the document's pretty-printed JSON size in heap. A
full history on an eight-part song holds under 4 MB.
