# Console ratio floor to 0.0625, and the no-magic-numbers fence over tools

- Date: 2026-09-18
- Area: audio
- Links: #618 · #622 (the console consolidation epic) ·
  `2026-09-18-drum-bank-ratio-floor-and-two-noise-algorithms` (why the floor
  came up) · #587 (Coarse / Fine) · #225 decision 8 (data separate from logic)

## Decision

1. **The `no-magic-numbers` fence covers `tools/*/src/**/*.ts`** with the same
   ignores the packages have (`*.test.ts`, `*Constants.ts`, `*Defaults.ts`,
   `*Table*.ts`). The console's 81 bare tunables moved into one exported
   table per area beside its logic (`knobConstants.ts`, `keyboardConstants.ts`,
   `patchKnobTables.ts`, `sequencerKnobTables.ts`, `harmonyTables.ts`,
   `mixerTables.ts`, `arrangementConstants.ts`, `envCanvasConstants.ts`,
   `harmonicConstants.ts`, `scopeConstants.ts`, `patchPanelConstants.ts`,
   `hostConstants.ts`), the palette into `consoleColors.ts`, the formatters
   into `consoleFormat.ts`, the sequencer vocabulary into
   `sequencerConstants.ts`. A knob default is no longer stated in the console:
   a patch knob reads `makePatch()` at its path (`PatchKnobEntry` has no `def`
   field), a sequencer, harmony or mixer knob reads the kind's
   `DEFAULT_*_CONFIG` or the normaliser's constant, BPM reads
   `NEW_SONG_BPM`; `knobDefaults.test.ts` walks every table. The one tool the
   glob now reaches that is not the console, `tools/collision-spike/`, is
   fenced out by name in the same block: a throwaway measurement harness by
   its own README, nothing in `packages/` imports it, and its 40 bare numbers
   are measured tables and report column widths.
2. **`RATIO_MIN` is 0.0625 in the console** (Pat, 2026-09-18): four octaves
   under the note, two under the drum bodies the bank pinned at 0.25. The
   engine and `patchNormalise.ts` stay unclamped; `ratioSplit.test.ts` checks
   split / join at the floor and at a value between 0.0625 and 0.25, and the
   Coarse / Fine readout at the floor. No library ratio is below 0.25 today,
   so no patch file changes.

## Why

The console was written before the packages' data-separate-from-logic rule
and never fenced, so the same tunable lived in several places and drifted: a
Euclidean `k` default the engine never chooses (#617), an arpeggiator skip of
0.3 against the engine's 0.2, a Euclidean note of 36 against the normaliser's
middle C, two `KIND_LABELS`, two `fmtMs` roundings, the accent colours in six
files. Reading a default from the engine makes double-click reset follow a
schema change for free, and the table files make the ranges injectable.

The 0.25 floor was the console's, not the engine's, and the drum bank had to
author its kick bodies around it: a 52 Hz body on C4 (ratio 0.199) could not
be a factory patch, so the bank named the note that gives the machine's pitch
instead. Lowering the floor to 0.0625 gives sub-bodies two more octaves
without changing what the engine accepts from a file.

## Rejected

- Clamping in the normaliser too: changes what the engine accepts from a file
  for no sound gained.
- Leaving 0.25: keeps drum bodies pinned at the wrong pitch.
- Moving the collision harness's numbers into tables: outside the ticket's
  folders and a spike the README calls throwaway; a follow-up if it is ever
  kept.
- Reading the palette from the template's CSS custom properties through
  `getComputedStyle`: the canvases and inline SVG would then depend on the
  stylesheet having been applied; a TS palette with an equality test against
  the template (`consoleColors.test.ts`) keeps one definition without the
  timing.
