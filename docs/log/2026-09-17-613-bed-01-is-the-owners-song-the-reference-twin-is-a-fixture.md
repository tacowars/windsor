# bed-01 is tacowars's song; the reference twin of the TypeScript arrangement is a fixture

- Date: 2026-09-17
- Area: audio
- Links: issue #613 · commit 76471747 ("adding new songs") ·
  `2026-08-31-arrangement-console-and-runtime-arrangements` (§3, §5) ·
  `2026-09-17-music-parts-are-a-slot-list-with-a-sequencer-kind` (the
  sample-identical conversion of the old bed-01)

## Decision

tacowars replaced `arrangements/bed-01.json` with a new song of their own on
2026-09-17 and, asked whether to restore the old file and ship theirs as
bed-04, chose to keep theirs as bed-01 (tacowars, 2026-09-17). So:

- **`bed-01.json` is a song like any other in `arrangements/`**: the game's
  default (`DEFAULT_ARRANGEMENT_NAME`), edited in the console, and held to
  the gate — usable, nothing dangling, nothing corrected, every generator
  constructs — and to nothing else. `arrangementGate.test.ts` no longer pins
  its parts to the `#69b` fixture.
- **The JSON twin of the `#69b` TypeScript arrangement is a fixture**,
  `__fixtures__/arrangementDocuments/reference-bed.json` — the old bed-01,
  byte for byte. `arrangementEquality.test.ts` proves it against
  `FULL_DOCUMENT` exactly as before: structural equality and a
  sample-identical four-bar render. What that test guards is the JSON codec
  and the normaliser against the TypeScript fixture, not what ships.

## Why

The equality test was written when bed-01 was the only song and the console
did not yet exist; it made the shipped song and the code fixture one thing.
Now that songs are authored in the console and exported, a musician's edit
to the default song must not fail `verify` because a test expected the
fixture's four parts. The fixture keeps the codec proof; the song is free.

## Punted / alternatives

- **Restore the old bed-01 and ship tacowars's song as bed-04.** The smaller
  change; rejected by tacowars, who wants their song as the default.
- **A pre-push format check.** The commit also went to main unformatted
  (the first half of #613). The pre-push hook checks secrets and
  `.gitignore` only; adding `format:check` to it is worth a ticket, not
  folded in here.
