# Step variation's controls: Vary, Chance and two glyph toggles

- **Date:** 2026-10-24
- **Status:** accepted. tacowars decided the names and the kind of control
  on PR windsor#939 on 2026-10-24 (decisions 1 to 3), then approved the
  revised mockup as drawn, which settles where the glyph buttons sit, their
  glyphs and the lane readout (decisions 4 to 6). The build, windsor#936,
  measured the portrait tablet (decision 7).
- **Mockup:** `docs/design/step-variation-controls-mockup.html`, with its
  frames rendered as `docs/design/step-variation-controls-today-*.jpg`
  (main at 1a71af2, captured from `npm run dev` in the project's headless
  Chrome) and `docs/design/step-variation-controls-proposed-*.jpg`.
- **Links:** this record's issue, windsor#936 · the engine fields,
  windsor#935 (`randomness`, `probability`, `restsSound`, `octaveMode`,
  replacing Skip on the Grid and the Arp)

## Context

windsor#935 gives the Grid and the Arp four fields for varying a step as it
plays: two amounts, `randomness` (how far a step that varies strays) and
`probability` (how often a step varies), and two switches, `restsSound` and
`octaveMode`. windsor#936 puts them on both devices. Its decision 4 left
the labels open, since the Randomize button already sits on both cards and
rerolls the written pattern, so "Randomness" beside it reads like its
amount. The first mockup drew the issue's names, with alternatives, and
the two switches as off | on switches in a column of their own.

## Decisions

1. **The knobs are Vary and Chance.** Vary is `randomness`, Chance is
   `probability`. Both are today's sequencer knob, 0 to 1 shown as 0% to
   100%. Their lanes (`seq.randomness`, `seq.probability`) carry the same
   names in the + Add lane list and the lane row. Measured in the app at the
   knob label's 8.5 px, Vary is 24.3 px and Chance 38.3 px, both inside the
   52 px knob, so no knob column widens.
2. **Rests sound and Octave are glyph buttons that toggle**, not off | on
   switches, so the pair takes little width. Each is drawn as the app draws
   a toggled icon button (`.seq-icon` with `aria-pressed`, the part's accent
   when on), at the size of the icon buttons where it sits. Both are off by
   default.
3. **Each button explains itself in its tooltip** (its `title`), one
   sentence, with its name as its accessible name:
   - Rests sound: "Rests sound: a varied step may also go silent or sound
     where a rest was written".
   - Octave: "Octave: pitch strays by whole octaves of the step's own note
     instead of borrowing another step's".

4. **The buttons sit by the knobs**, as the mockup recommends and draws
   them: the Grid's side by side in the empty third row of the Vary and
   Chance column, at no width; the Arp's in a 22 px column beside Gate,
   Vary and Chance, Rests sound level with Vary and Octave with Chance, 24
   px wider. Not on the rail.
5. **The glyphs are the recommended pair**: Rests sound is the eighth-rest
   sign, Octave an 8 with an arrow up and an arrow down.
6. **The Vary and Chance lanes read a percent** (30%), as their knobs do.
7. **The portrait tablet does not scroll.** The mockup reckoned the Arp
   would scroll 11 px; built, on the portrait tablet (1024 × 1366, touch)
   the Arp device is 976 px wide and ends 13 px inside the rack, and the
   Grid's 965 px device ends 24 px inside it, so neither scrolls.
