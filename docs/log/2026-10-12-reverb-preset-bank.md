# The Reverb's spaces give way to a 27-preset bank

Date: 2026-10-12. Issue: windsor#774. Item 8 of
`docs/research/2026-10-11-plate-reverb-upgrades/README.md`, whose §8 table is
the bank's spec. The figures are in
`docs/research/2026-10-12-reverb-preset-bank/`.

## Why the bank replaces `SPACES`

The six spaces (`plate`, `room`, `hall`, `cathedral`, `wash`, `shimmer`)
date from before the reverb upgrades (Decay in seconds with a low band,
Build, the stereo input, the irregular modulation, the denser taps and the
`Plate | Room` voicing) and were only carried through them. All six were
plate-voiced, and none showed what the reverb now does. The bank's job is to make those upgrades easy to reach, and
`SPACES` was always marked transitional.

- **27 presets in four groups:** Everyday, Drums, Pads & leads and Ambient,
  numbered 1–27 in the note's order, with the note's names. Eight are
  room-voiced.
- **Built like the Retro reverb's bank.** `inserts/reverbPresets.ts` holds
  the types, `applyReverbPreset` and `matchingReverbPreset`; the presets are
  table data, one file per group, and `reverbPresetBank.ts` concatenates
  them. Each preset writes all 17 space fields (the 16 numbers and
  `voicing`); Mix and the on/off switch stay the user's.
- **The picker.** The Reverb card's Starting point picker lists `custom`
  when nothing matches, then the bank under its groups. A pick writes the
  whole space live, voicing included, and the processor ducks across a
  voicing change as it already did.
- **`SPACES`, `SPACE_NAMES` and `SpaceName` are gone** from
  `mixer/reverbSpace.ts` and the engine index. The DSP tests measured with
  their rows, so the rows they read (`plate`, `room`, `hall`, `cathedral`,
  `shimmer`) are copied verbatim into
  `__fixtures__/reverbSpaceFixtures.ts`, and no test's input, threshold or
  expected figure moves. The tests that only described the six spaces
  (their order by Size, their modulation numbers, all plate-voiced) went
  with them.

## Resident carries `hall` bit for bit

**Resident**, preset 1, is the default: `REVERB_PRESET_DEFAULT` (renamed
from `REVERB_SPACE_DEFAULT`) is its number. Its settings equal the `hall`
space field for field, `build` 0.1 and `voicing: 'plate'` included, and a
test compares them with the fixture's copy. `DEFAULT_REVERB`, and so a new
Reverb insert and Send A's default chain, take Resident's settings, so
every default render stays what it was: the reverb and FM goldens pass with
no fixture refreshed.

## Successors

The other five spaces each hand their role on, not their values:

| Space | Successor | |
|---|---|---|
| `plate` | House Plate | the all-round plate |
| `room` | Back Room | now room-voiced |
| `cathedral` | Old Mill | the biggest room the voicing reaches, at Size 4 |
| `wash` | Last Train | the wash |
| `shimmer` | White Label | clean and bright, for leads |

Each is voiced to the note's row.

## The level rule

Every preset was rendered at Mix 1, 48 kHz, through the shipped processor
(`bankRig.mjs`), for its broadband T30 from a click, and for its wet RMS and
peak on a drum loop and a pad chord, each 2 s plus the tail. A preset's level
is its wet RMS on its group's material (the drum loop for Everyday and
Drums, the pad chord for Pads & leads and Ambient), and it sits within
±2 dB of Resident's on the same material.

- **Trims use the preset's own fields:** the input and tank cuts, the
  damping, the low band and, where those ran out, Size, Build and the
  modulation depth. There is no gain field.
- **Most of the drum presets' trim is the low cuts.** The loop's RMS is
  mostly its kick, so the cuts set the level.
- Every T30 lands within 10 % of the note's aim, so no preset is a
  deviation under the issue's 20 % rule.
- Each group's table file lists its presets' T30, level and peak in its
  header.

## Format: none

A song stores the space's values, never a preset name or number, so
replacing the bank changes no saved song. A song saved on one of the old
spaces other than `hall` keeps its sound and shows `custom`, and Resident
keeps the default render. `ARRANGEMENT_VERSION` stays 15.
