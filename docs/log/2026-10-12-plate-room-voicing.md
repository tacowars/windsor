# The plate's room voicing, and the render it moves

- **Date:** 2026-10-12
- **Status:** proposed with windsor#746; the deviations below wait for
  tacowars's ruling
- **Links:** issue windsor#746 · the plan
  `docs/research/2026-10-11-plate-reverb-upgrades/README.md` §7 · the
  measurements `docs/research/2026-10-12-plate-room-voicing/README.md` · items
  1 to 5, `2026-10-12-plate-decay-in-seconds`, `2026-10-12-plate-build-control`,
  `2026-10-12-plate-stereo-input`, `2026-10-12-plate-modulation` and
  `2026-10-12-plate-output-taps` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy` · the no-step test in
  `2026-08-31-dattorro-reverb-not-plateau` §3

## Context

The plate had one voicing: input diffusers of 3.6 to 12.7 ms that smear the
onset and never follow Size, one Build table and one tap table. The plan's §7
gives the one tank two voicings, a row of data each: a plate whose onset is
instant and dense, and a small to medium room whose early reflections stay
distinct and grow with Size.

## Decisions

1. **A voicing is a row, both rows of one shape**
   (`worklet/reverb/reverbVoicingTables.ts`): both chains' diffuser lengths
   and whether they follow Size, Build's tap times, gain rows and direct
   levels, and the output taps (times, lines, signed gains, twelve a side)
   with their trim. Built as typed arrays at load, so both rows have one
   element kind and the sample loop reads either through the same code. The
   processor holds the playing row's arrays in fields; a switch is a pointer
   swap at a block boundary (`plateVoicing.ts`). Size keeps 0.05 to 4 in both.
2. **The plate voicing.** Its diffusers are 0.383, 0.533, 0.650 and 0.804 ms
   (L) and 0.331, 0.498, 0.580 and 0.747 ms (R), fixed. Windsor's own,
   chosen by measurement (`plateSearch.mjs`): 600 sets drawn between 0.25 and
   1.5 ms, each R its L off by 3 to 15 %, read for windsor#763's side leads
   and mirror at Build 0 at 48 and 44.1 kHz and for the held 1 kHz sine's
   beat; of the four that kept every cell but Size 4's with 0.05 dB to
   spare, this one has the most to spare. It keeps windsor#761's Build table
   and windsor#766's tap table and trim unchanged.
3. **The room voicing** (`reverbRoomTables.ts`), Windsor's own throughout:
   - **Diffusers** 4.881, 3.220, 12.439 and 9.249 ms (L) and 5.532, 3.748,
     10.023 and 8.402 ms (R) at Size 1, each drawn within ±15 % of the length
     its line held before (`roomSearch.mjs`; 81 of 150 draws passed the side
     cells, an early field sparser than the plate's and T30 at two corners;
     this one with the most to spare). They follow **Size's square root**,
     not Size: scaled linearly they ring outside the loop for over a second at
     Size 4, and Decay 1 s at Size 4 read +15 % (−1.3 % under the root).
     `_applySize` writes the law and `INPUT_CAPACITY` allocates for it.
   - **Build**: tap times spread to 91 ms at Build 1 (the plate's to
     149 ms); the first tap alone at Build 0, so every output tap is one clean
     reflection; even at 0.5; rising at 1. **No direct path** at any Build: a
     room's first arrival is its first reflection, which follows Size (0.23,
     1.21, 4.90 and 19.58 ms at Size 0.05, 0.25, 1 and 4), where the plate's
     burst lands at 0.
   - **Taps**: each side's nine on its own half (its input all-pass at about
     5 ms, then four on the long line after it to about 68 ms, then the far
     two lines), three on the other half past 50 ms at Size 1; signs
     alternating, gains 0.75 and 1; each right tap within 3 to 9 % of its left
     counterpart's time on the matching line, so the windows carry like
     energy without one pattern on both sides. Every tap inside 1 ms to 95 %
     of its line.
   - **Trim** `ROOM_OUTPUT_TRIM` 0.4856: the room's mean level over Build 0,
     0.5 and 1 on the plate voicing's (−0.00 dB at 48 kHz).
   - It was tuned at the default diffusions (0.75, 0.625, 0.7, 0.5). Item 8's
     room-voiced starting points may take lower ones; the processor applies
     none of them (the issue's decision 4).
4. **The switch ducks the wet output and the tank's feed.** A change makes
   the processor ramp a gain to 0 over `INSERT_SWITCH_FADE_S`, a sample at a
   time, written out in the sample loop (no call: `mixer/reverbLowBand.test.ts`
   reads the loop's calls off the bundle). Throughout, the block renders with
   a preallocated snapshot of every parameter as it stood the block before
   the change. At the first block boundary at silence the new row and the
   live fields apply together, both input chains and both Build lines are
   emptied, the taps and input lengths land outright, Build lands on its
   parameter, and the gain ramps back to 1. The tank's loop is never
   cleared; its lines keep their Size ramp.
   - **The feed, too.** The plan ducks the wet output; ducked alone, emptying
     the chains restarted their output as a step into the tank, which came
     round after the fade in: a steady tone stepped 1.7 times the still
     plate's. Ducking the feed with it turns the restart into a 5 ms fade,
     0.51 to 0.90 of the still plate's.
   - **A change during the duck.** One that arrives while the gain goes down
     is taken at that duck's silence, with no second duck: the row applied is
     the one asked for then, and when that is the row already playing (a
     flip and back) nothing is swapped or emptied and the live fields simply
     apply. One that arrives while the gain comes back up turns the ramp
     round from where it stands.
   - **Asleep, or fresh.** A plate constructed, or woken from sleep, applies
     the asked row at once on its first block: its tank is empty. A change
     while asleep therefore applies at once, and the woken render matches a
     fresh plate's in the new voicing to the bit. A sleep or a `clear` during
     a duck ends it the same way.
   - **The main thread schedules nothing**: `writePlate` writes `voicing` as
     its number like any field.
5. **The field.** `ReverbSpace` carries `voicing: 'plate' | 'room'`, so the
   Send A bus's Plate insert (the `room` return since windsor#172) and every
   Plate insert carry it in the song. The processor's `voicing` parameter is
   k-rate, 0 to 1, 0.5 and up the room; `writePlate` and `createPlate` map
   between the two (`VOICING_PARAM`). A missing `voicing` normalises to
   `plate`; an unknown one is corrected to `plate`. Every row of `SPACES` and
   `DEFAULT_SPACE` states `plate`. It has no lane row, and the Plate insert's
   lane handles leave it out. `REVERB_SPACE_RANGES` stays the numeric fields'
   clamp: `voicing` is a choice, normalised from `PLATE_VOICINGS`, and
   `mixer/reverbSpace.test.ts` holds its descriptor to 0..1 beside the ranges.
6. **The switch on the card** is `Plate | Room` (`seg`), under a `Voicing`
   label as the Filter card labels its mode, at the start of the Plate card's
   Diffusion page, before `Diff 1`. The `room` return's card is the Send A
   bus's Plate card since windsor#172, so the one card serves both. Picking a
   starting point sets it; flipping it commits `voicing` alone.
7. **Every reader of a swapped table follows the playing row**: the input
   lines' nominal lengths and their Size law (`_applySize`), the input lines'
   capacity (`INPUT_CAPACITY`, the longer row at Size's top under the law),
   Build's tap times, gain rows and direct levels (`configureBuild`), the
   Build lines' capacity (`BUILD_LINE_SPREAD`, the longer row's), the taps'
   times and lines (`_applySize`) and lines and gains (the loop), the trim on
   the wet output and on the sleep's reading (`_outputTrim`), Build's direct
   path aimed at `BUILD_DIRECT_TRIM` over the playing trim, and the sleep span
   (which now counts the longer input chain, `INPUT_SPAN`). The modulation's
   clamp reads the tank lines only, which no voicing changes. The harness
   reads `VOICING_ROWS`, `BUILD_LINE_SPREAD` and `INPUT_SPAN`; the tests that
   read tap tables loop over both rows.
8. **L's chain is written out**, as R's has been since windsor#763: `tank.ts`
   had passed 350 lines with the duck, and the written-out chain is shorter
   and renders the same bits (with the old lengths every golden row but the
   two sleep rows, which moved with the sleep span, kept its hash). It is also
   cheaper: the plate costs 37.95 µs a quantum against `main`'s 45.42 in
   Node 24.21.0 (−16 %), and 40.43 against 47.50 µs in headless Chrome 155 on
   the page's main thread, both on an Apple M1 shared with other sessions.
   The room reads 37.84 and 40.22 µs, a plate ducking every few quanta 38.04
   and 40.46 µs. With L's chain still called, the voicing cost 45.9 to
   47.2 µs in Node. Nothing allocates per block, a switch included.
9. **The reverb golden is re-pinned on purpose.** The plate voicing's
   diffusers move every render that reaches the tank, and the sleep span
   moved the sleep rows. Of `main`'s twenty-six scenarios, twenty-five moved:
   `anti-phase`, `build-moves`, `build-one`, `build-zero`, `click-left`,
   `click-right`, `decay-long`, `decay-short`, `decay-step`,
   `filters-and-modulation`, `hold`, `hold-released`, `impulse`, `low-band`,
   `low-band-moves`, `max-diffusion`, `mod-deep-fast`, `mod-held`,
   `size-and-decay`, `size-box`, `size-cathedral`, `size-glide`, `sleep`,
   `sleep-and-wake` and `wet-late`. `dry-only`, which never reaches the tank,
   kept its hash. Four were added: `room-impulse`, `room-size-glide` (the
   room's input lines gliding with Size), `switch-to-room` and
   `switch-to-plate` (a noise burst's tail at Decay 10 s, the voicing switched
   at 1 s). `fmProcessorGolden` did not move, and the Retro Reverb's tests
   pass untouched.
10. **`ARRANGEMENT_VERSION` goes from 13 to 14, with no upgrade.** The plate
    voicing's shorter diffusers change how every saved song's plates sound,
    and no voicing renders the old diffusers. A song saved at version 13 or
    earlier is refused with the standard format message. `songMigrations.ts`
    keeps its steps up to 10; the upgrade tests read through a 13 → 14
    stand-in.

What it measures (research note): the plate voicing's first arrival is
`main`'s (0 ms) and its 20 ms energy 5.2, 4.8 and 4.2 dB over `main`'s at
Size 0.25, 1 and 4; the room's early density at Size 1, Build 0 is 7 052
against the plate's 7 668; T30 holds ±10 % at Decay 0.5, 2 and 10 s at Size
0.25, 1 and 4 in both voicings but for Decay 0.5 s at Size 4; a centred
source sits within 0.65 dB of centre and the mono sum within 0.5 dB of
`main`'s, no band more than 1.22 dB under; the plate voicing's level is within
0.33 dB of `main`'s and the room's within 0.33 dB of the plate's; every switch
steps under the still plate's step.

## Deviations for tacowars

1. **The plate voicing's mirror at Size 4 misses**, Build 0: L alone's left
   over R alone's right reads −3.61 dB in 50–200 ms (−3.54 at 44.1 kHz)
   against the 1.25 dB windsor#765 and windsor#769 accepted; 0–50 ms reads
   1.25 (0.98). With diffusers under 2 ms the click is no longer smeared
   across the windows, and windsor#766's first taps set the split: the right
   output's line-5 tap of gain 1 lands in 50–200 ms at Size 4 where the left
   hears only recirculations. No set under 2 ms held it; the old lengths
   scaled to 0.5 (6.4 ms) would. Retuning windsor#766's table for the plate
   voicing would fix it, and the issue keeps that table. The test holds the
   plate voicing's Size 4 mirror to 3.75 dB.
2. **Decay 0.5 s at Size 4 reads long in both voicings**: +46 to +55 % in the
   plate voicing and +75 to +77 % in the room, against `main`'s +43 to +47 %.
   One pass of the long lines at Size 4 takes 0.6 s and loses 72 dB, so the
   fit reads where the taps sit in time; the room's diffusers add their own
   ring. The correction was not re-measured; no table reaches it.
3. **The feed is ducked with the output** (decision 4), where the plan named
   the output.
4. **`voicing` is not in `REVERB_SPACE_RANGES`** (decision 5), where the issue
   lists the ranges among `build`'s footprint: the ranges are the document's
   numeric clamp, and `voicing` is a string in the song.
5. **The room's held 1 kHz sine beats −18.36 dB**, over the −18.5 dB that
   `mixer/reverbModulationSpread.test.ts` holds the default voicing to
   (`main` −19.45, the plate voicing −19.63).
6. **A `Voicing` label** sits above the switch, as `Mode` sits above the
   Filter's; the issue names only `Plate | Room`.
7. **Corners of the whole box.** Under HOLD at Decay 0.2 or 0.5 s and Size
   0.05 or 0.25, the plate voicing's first second is up to 6.8 dB under
   `main`'s (48 of 960 cells inside the ceiling past ±1.5 dB at 48 kHz): HOLD
   engages 0.1 s after the click, when the old diffusers were still feeding
   the tank and the new ones have finished. A centred click at Size 4 with all
   four diffusions at 0 and Decay 0.2 s sits 2.23 dB off centre at 96 kHz
   (`main` 1.63). The research note has the box.
8. **Every buffer is sized at the running rate**, for the longer voicing,
   as every plate buffer is (`2026-10-12-plate-build-control` deviation 5),
   not at a fixed highest rate; nothing wraps short at 96 kHz at Size 4 with
   the longest pre-delay and Build (`mixer/reverbVoicing.test.ts`).

## Consequences

- Every song saved before version 14 is refused.
- The plate's sound changes wherever the tank runs, and tacowars listens on
  the PR preview before it merges; the room voicing is new, and its tables
  wait for the ear.
- Item 8's bank brings room-voiced starting points; until then every
  starting point is plate-voiced, and the switch is how a room is heard.
- The plate costs less a quantum than it did, in either voicing and ducking.
