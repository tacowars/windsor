# Euclid lanes and ratchets

- **Date:** 2026-10-01
- **Status:** accepted (tacowars's direction of 2026-10-01)
- **Links:** windsor#355 (engine and format) · windsor#356 (the card) ·
  the mockup in `docs/research/2026-10-01-euclid-lanes/mockup.html`
  · step modulation lanes (windsor#17, windsor#31) · the grid's accent
  (#602) · `2026-09-29-each-region-plays-its-own-pattern`

## Context

A Euclid part plays one row: `E(k, n)` with rotation, `k` moved on bar
lines by an LFO or a walk, or a captured figure. Every hit reaches the part
through `trigger(note, velocity, hold)` at the part's own velocity, so a
Euclid part has no accent, no per-step change of sound and no pitch. The
grid already has an accent and modulation lanes (`stepModLanes.ts`), and
they ride on its note-ons as extras.

tacowars wants the Euclid card to become a stack of rows: the trigger row,
a ratchet row above it for hat rolls and trills, and lanes below it for
accent, pitch and the sound, each lane of its own length, so the accents
and the tone fall against the hits in polymeter.

## Decision

1. **A Euclid part is a stack of rows on one clock.** The trigger row is
   unchanged: its `k`, bounds, density modulator, rotation and captured
   figure work as they do today, and the density modulator still re-cuts
   only the trigger row on bar lines; the ratchet row and the lanes never
   move with it. A ratchet row sits above it and lanes sit
   below it. Every row runs on the trigger's divisor; no row has a clock of
   its own.
2. **A lane has its own length,** 1–32 steps. Its step is the trigger's
   local step mod its length, the same local step the trigger counts
   (`stepAt`), so every lane restarts wherever the trigger restarts: at a
   region's entry. Different lengths are the polymeter. The card reads out
   the full cycle, the least common multiple of the trigger's steps and
   every lane's length, in bars.
3. **A lane is read at a hit.** When the trigger row sounds, each lane's
   value at that step rides on the hit. A lane never makes a hit, and a
   lane's value under a rest is not heard.
4. **A lane is drawn: one value per step.** Lanes are not Euclidean
   figures. The kinds:
   - **Accent:** on or off per step. An accented hit adds the part's
     `accentVelocity` to its velocity and sends `accentMod`, as a grid
     accent does. The Euclid part takes the two amounts as its own fields,
     defaulting to `ACCENT_VELOCITY_DEFAULT` and `ACCENT_MOD_DEFAULT`.
   - **Pitch:** a whole number of semitones per step, −24..24, added to the
     part's `note`; the sum is clamped to MIDI 0..127.
   - **Sound:** a `StepModParam` with a value per step in −1..1, meaning
     exactly what a grid lane's value means (`STEP_MOD_TABLE`).

   A part has at most one accent lane, at most one pitch lane, and at most
   `STEP_MOD_LANES_MAX` (4) sound lanes, each parameter once. The accent
   and pitch lanes do not count against the four.
5. **Lanes are fixed.** Nothing modulates a lane: no density, no walk, no
   rotation.
6. **The ratchet row** holds one value per trigger step, 1, 2, 3 or 4, and
   follows the trigger's step count when Steps changes. It is keyed to the
   step, not to the hit: it sounds only where a hit lands, so a density
   change can move a hit onto or off a ratchet.
   - A ratchet of `N` plays `N` hits spaced evenly across the step's
     duration in seconds, starting on the step's swung time. The spacing is
     in time, not ticks, so ×3 and ×4 play at any divisor.
   - Each hit of a roll is held for the smaller of the part's `hold` and
     its slice of the step.
   - Every hit of a roll carries that step's accent, pitch and sound
     values. There is no roll shape (no ramp across the roll).
7. **Euclid hits carry the grid's extras.** A Euclid hit still reaches
   the part through `trigger`, which now takes the same `NoteExtras` a
   grid note-on carries (the accent's `mod` and the step-mod offsets), so
   each hit's note-off releases only that hit. The accent's velocity rule
   is `partNoteOn`'s. A part with no lanes and no ratchets plays exactly
   what it plays today.
8. **Format.** The new fields are additive on the Euclid part and on a
   region's Euclid pattern, which carries the kind's whole config:
   `ratchets` (one 1–4 per step), `accentVelocity`, `accentMod`, and the
   lanes. Absent means today's behaviour, so `ARRANGEMENT_VERSION` does not
   change (`2026-09-28-format-versions-refuse-never-destroy`). The
   normaliser drops an unknown or repeated sound parameter, a fifth sound
   lane and a second accent or pitch lane, clamps every value into its
   range and a lane's length into 1–32, and fits `ratchets` to the step
   count, reporting each correction, as it does for the grid's lanes.
9. **Two lane views, toggled on the device's rail.** *Own length* draws
   each lane at its own length, one cell per lane step, with its own
   playhead. *Under the hits* lays each lane out under the trigger's
   current pass, a notch where the lane starts over and the cells under a
   rest dimmed, so a cell reads as what that hit will get. An edit in
   either view writes the same lane step. The view is the console's, not
   the song's: it is not saved in the document.
10. **Two pages, as the inserts have them.** The device's body has page
    tabs over the page, drawn as an insert with two or more pages draws
    them (`.insert-tabs`): **Pattern** holds the Play knobs, the ratchet
    and trigger rows and the lanes; **Density** holds the modulator, its
    plot of `k` and the `k` bounds. The tab row keeps a one-line readout
    of the modulator (`k`, its bounds and its kind), so `k` can be watched
    from Pattern. Moving the modulator off Pattern leaves that page the
    height for more lanes. Like an insert's, the shown page is the
    session's, not the song's.
11. **Review class.** The song document schema and the card's layout both
   change, so the PRs are `reviewed`.

## Not now

- Roll shapes (a ramp in velocity across a roll).
- Euclidean lanes (a lane drawn by `E(k, n)` and one amount): considered
  and set aside for drawn values.
- A lane with its own clock, or with density or rotation of its own.
- Capture of lanes: lanes are drawn, so there is nothing to freeze.
