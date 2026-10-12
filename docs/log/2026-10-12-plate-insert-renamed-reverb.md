# The Plate reverb insert is renamed Reverb, kind id included

Date: 2026-10-12. Issue: windsor#771. Decided by tacowars.

## Why

The insert started as the `room` return's plate on a strip (windsor#171),
and "Plate reverb" described it. Since then it has gained a stereo input,
Build, a low band, irregular modulation and, with windsor#746, a
`Plate | Room` voicing switch. A reverb called "Plate" whose switch offers
"Plate" as one of two voicings reads wrong. The insert is now **Reverb**.

## What changed name

- The label: `INSERT_LABELS`' entry reads `Reverb`, where it read
  `Plate reverb`. The insert menu, the card's title and the Mixer's chains
  all read it.
- The insert kind id: `plate` became `reverb`, in `INSERT_KINDS`,
  `InsertKindName`, the card table, the automation tables' rows, Send A's
  default chain (`mixer/mix.ts`) and the tests.
- The insert's own files and identifiers:
  - `inserts/plateReverbInsert.ts` → `inserts/reverbInsert.ts`, and
    `inserts/plateReverbConstants.ts` → `inserts/reverbInsertConstants.ts`,
    with the insert's test moved beside them;
  - `PLATE_REVERB_INSERT`, `DEFAULT_PLATE_REVERB`, `PlateReverbSpec`,
    `PLATE_REVERB_MIX_DEFAULT` and `PLATE_REVERB_SPACE_DEFAULT` →
    `REVERB_INSERT`, `DEFAULT_REVERB`, `ReverbInsertSpec`,
    `REVERB_MIX_DEFAULT` and `REVERB_SPACE_DEFAULT` (`ReverbInsertSpec`
    keeps it apart from `ReverbSpace`);
  - `app/src/plateReverbCard.ts` → `app/src/reverbCard.ts`, and
    `PLATE_REVERB_KNOBS` → `REVERB_KNOBS`;
  - the automation tables' `PLATE_ROWS` → `REVERB_ROWS`.
- The engine index exports the new names, with no aliases for the old ones.

## What kept its name

- The DSP: a Dattorro-style plate tank. The worklet and everything under
  `worklet/reverb/` (`DattorroReverb`, `reverb-processor.js`, "the plate" in
  its comments) are unchanged, and nothing audible moves: the reverb and FM
  goldens pass as they were.
- `ReverbSpace`, `SPACES`, `plateSpace` and the mixer's `createPlate` /
  `writePlate`, which drive the processor on a return as well as on the
  insert.
- The voicing's `plate` value, and the `plate` space in `SPACES`.
- The Retro Reverb (`retro-reverb`).
- The records in `docs/log/` and the research folders, which are history.

## Format

`ARRANGEMENT_VERSION` goes from 14 to 15 with no upgrade, by tacowars's
decision: no user has songs to keep. A song saved at 14 or earlier is
refused with the format message
(`2026-09-28-format-versions-refuse-never-destroy`). A current-format
document that still names `kind: 'plate'` reports it as a dangling kind, as
any unknown kind is.
