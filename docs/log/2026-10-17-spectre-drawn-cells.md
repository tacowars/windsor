# Spectre: a spectral workbench of drawn cells

- **Date:** 2026-10-17
- **Status:** accepted (tacowars, 2026-10-17: "implement what you think
  would be a modern version"). tacowars tried the build in the app and
  approved it on 2026-10-17
- **Revises:** `2026-10-16-spectre-insert` decisions 5, 6, 8 and 13, and its
  "Not done" items on drawing at full resolution, separate L/R curves and a
  sonogram
- **Links:** the insert contract `inserts/insertKind.ts` · Pump's scope
  (`2026-10-13-pump-insert` decision 5) · the EQ's Listen · format rules
  `2026-09-28-format-versions-refuse-never-destroy` · preset names
  `2026-10-11-insert-presets-carry-no-brand-names` and
  `2026-10-12-reverb-preset-bank`

## Context

Spectre draws each of its three curves (gain, delay and feedback) as 2 to 8
breakpoints joined by lines. A line is the wrong tool for this technique.
tacowars wants a surface to **draw on band by band**: leveled steps,
notches, combs and sieves carved into the spectrum, with the result heard
live.

Four observations about how the technique is played shaped the design:

- **The useful shapes are cell patterns.** Combs, sieves and scattered
  steps need far more than 8 points to draw.
- **Delays are drawn on a grid.** Rhythmic material wants each band's delay
  snapped to a tempo division.
- **Left and right differ.** The stereo comes from drawing the two channels
  apart.
- **The editing is the performance.** Freezing a sound and carving its
  feedback, drawing filters over long tails, and syncing delays to tempo,
  then breaking the sync, all happen while it plays.

tacowars asked how the idea would be presented if it were designed today,
in Windsor's browser context and look, free of fixed pixel grids, one
control per mouse button, sonograms in their own boxes and modal tool
palettes. This record answers that question:

1. **Draw on the sound.** The live spectrum is the ground of every lane.
2. **Everything in view, nothing modal.** The three lanes share one
   frequency axis, and one selection spans them all.
3. **Musical units.** The ruler names notes. A selection can follow a
   note's harmonics or the song's key. Delays read in beats.
4. **Brushes, not pixels.** Each tool has a width and follows pen pressure.
5. **Hear what you touch.** Listen solos the selected bands. Generators
   preview before they apply.
6. **The card summarises; the workbench plays.** The rack card is a
   thumbnail and a preset picker. The full window is the instrument.

The 8-point limit bought nothing. A curve's points are k-rate params, but
they are not automation targets ("The curves … are not targets",
`automationInsertTables.ts`); only the moves are automated, and those stay.

## Decisions

### The sound model

1. **A curve is 180 cells on the 20 Hz–20 kHz log axis.** That is about 18
   cells an octave, two thirds of a semitone each: coarse enough to draw
   steps by hand, and fine enough for combs and notches.
   - It doesn't depend on the rate or the resolution, as the breakpoints
     didn't.
   - Each cell holds a value from 0 to 1 with the curve's existing meaning:
     - gain: 0 is silence, and above 0 it spans 60 dB;
     - delay: 1 is the full scale;
     - feedback: the value itself.
   - The count is `SPECTRE_CELLS` in `spectreConstants.ts`.
2. **Bands read the cells smoothly by default.**
   - A band takes the value interpolated between the two nearest cell
     centres. Drawn plateaus stay level, and only their edges ramp, over one
     cell.
   - Each curve has a **Steps** switch. With it on, a band reads its nearest
     cell, and the edges are hard.
   - Shift slides the read along the axis, as today. Offset and the
     Selection offset are added to the cells before the read, and the result
     is held to 0..1.
3. **Each channel has its own cells, linked by default.**
   - Each curve has a **Link**. Linked, the song stores one list, and an
     edit writes both channels. Unlinking copies the left to the right.
   - Spread stays, and slides each channel's read half each way.
4. **One selection, across all three curves.** A selection is a set of
   cells: a column of bands, not a part of one curve.
   - Generators and transforms act on the selection, or on every cell when
     nothing is selected.
   - **Gain, Delay and Feedback select** (±1) move only the selected cells
     of their curve. They are automation rows, so a group of bands can be
     performed.
   - The song stores the selection as cell ranges, because the select moves
     depend on it.
   - **Follow** (Off, Key, Chord) makes the selection follow the harmony.
     It works as Bloom's Song chord does (windsor#729): the stage owns a
     `pitches` param, a 12-bit mask of pitch classes. While following the
     key, it holds the song key's notes; while following the chord, it holds
     each chord the harmony track's follower schedules, sample-accurately.
     - The selection in force is then the cells within `toneSemitones` of one
       of those notes, in every octave, inside what is drawn (or across the
       whole axis, when nothing is drawn).
     - So the select moves become harmonic. A feedback select up makes the
       chord tones ring while the rest decays, re-tuned at every chord
       change. A gain select down cuts the chord out.
     - The scope reports the pitch classes in force, so the workbench tints
       the followed cells as the chords change.
     - tacowars asked for this during the build: "follow the harmony track
       chord notes like bloom does".
5. **Cells travel by message, not as params.**
   - The curves, the selection and the Steps switches travel as one
     `Float32Array` (`spectreCellPayload`).
   - The payload is posted at construction (`processorOptions.cells`) and
     again on any `set` that changes it. The processor copies it into arrays
     it already holds, outside `process()`, so nothing allocates on the
     audio path (worklet rule 2).
   - The 51 point params (`<p>Count`, `<p>At<i>`, `<p>Val<i>`) are removed.
     A new cell is heard from the next frame. A gain edit is too small to
     click, and a delay edit smears as designed (`2026-10-16-spectre-insert`
     decision 4).
6. **Three LFO slots, each with a destination.**
   - This replaces the fixed routes to the delay offset, the gain shift and
     mod A.
   - Each slot has a **Destination** (a choice, `lfoDest1`–`3`) and a
     **Depth** (an automation row, `lfoDepth1`–`3`, ±1).
   - The destinations are each curve's Shift, Offset and Select, and mod A.
     A shift slides up to `lfoShiftOctaves` at depth 1.
   - The defaults are delay offset, gain shift and mod A at depth 0, so a
     default Spectre is unchanged.
7. **Freeze has two modes.**
   - **Hold** (today's Freeze) shuts the input and loops every band at full
     feedback.
   - **Carve** shuts the input but keeps the drawn feedback. A band drawn
     below full decays away while the rest holds, so you can carve into a
     frozen sound.
   - The mode is a choice (`freezeMode`). Freeze itself stays a switch lane.

### The live seams

8. **Scope.** While the workbench is open, the processor posts the input
   and output magnitude of each channel, binned to the 180 cells (the
   loudest band in each), together with the LFO's level.
   - It posts at most `scopeHz` times a second, reusing one report object,
     as Pump's scope does.
   - The stage exposes it as `spectreScope`, with `read()` and
     `setActive()`.
9. **Listen.** A `listen` message solos the selection: unselected bands are
   silenced after the delays, and the output is the wet path alone.
   - Listen is live only, never saved, and it ends when the workbench
     closes.
   - The stage exposes it as `spectreListen(on)`.

### The workbench

10. **The Expand view becomes the workbench.** It fills the window, on the
    console's expanded-view ground (`.roll-overlay`).
    - **Header:** the title, the Starting point picker, the channel target
      (**L | R**), **Listen**, undo and redo, and Close.
    - **Tools:** a vertical rail, each with its key:
      - **Draw (D)**, with Shift for a straight line;
      - **Push (P)**, which raises or lowers by the drag, with a soft edge;
      - **Smooth (S)**;
      - **Erase (E)**, which puts cells back to the lane's rest (gain 1,
        delay 0, feedback 0);
      - **Select (M)**, where Shift adds, Alt removes, and a double-click
        clears.
    - **Brush settings:**
      - **Width** in cells, changed with `[` and `]`;
      - **Levels** (off, or 2–16), which snaps drawn values to even steps;
      - **Snap**, which on the delay lane snaps values to the grid's
        divisions.
      - Pen pressure scales Push and Smooth.
    - **Lanes:** Gain, Delay and Feedback stacked over one frequency axis.
      - Each lane draws its cells as bars from its rest.
      - Behind the bars sits the live spectrum: the input filled faintly
        and the output as a line.
      - Over the bars, a line shows the curve as the bands hear it after
        Shift, Offset, Select and the LFO.
      - Each lane's head holds its name and scale, **Steps** and **Link**,
        and its Shift, Offset and Select knobs, which can be automated and
        locked like every insert knob.
      - The delay lane draws the grid's divisions.
    - **Ruler:** frequencies in Hz, the C of each octave, and, when Key is
      on, the song's scale degrees marked.
    - **Selection:** selected cells are tinted in the carrier accent across
      all three lanes.
    - **Readout:** under the pointer, the band's frequency span and nearest
      note, then gain in dB, delay in beats and ms, and feedback in %.
    - **Shape panel:** a row under the lanes for generators and transforms.
      - **Generators:**
        - sine, triangle, square, saw up and saw down, each with an amount,
          a base, a period in octaves and a phase;
        - random, seeded, with an amount and a base;
        - **Harmonics**, the series of a root note: count, width and level;
        - **Key**, the song's key and scale in every octave: width and
          level.
      - A generator writes into the hovered or last-touched lane, within
        the selection. It shows as a ghost until **Apply** or Enter; Esc
        drops it.
      - **Transforms:**
        - Smooth;
        - Quantize, to the grid on the delay lane and to Levels elsewhere;
        - Flip along the axis, within the selection's span;
        - Invert;
        - nudge one cell left or right (the arrow keys);
        - Copy L→R and R→L;
        - Reset the lane.
    - **Undo.** Every stroke, apply and transform is one step in the app's
      undo history, named for the tool.
    - **Keys:** 1/2/3 pick the lane for generators. Cmd/Ctrl-Z and
      Shift-Cmd/Ctrl-Z undo and redo. Esc drops a preview, or else closes.
11. **The rack card summarises.**
    - **Curves page:** a thumbnail of the three lanes (a click opens the
      workbench), the Starting point picker, Expand, and each curve's Shift
      and Offset.
    - **Time page:** gains the Freeze mode.
    - **LFO page:** shows the three slots, each a destination and a depth.

### Presets

12. **A preset bank with a Starting point picker,** built like the Reverb's
    and the Retro reverb's banks.
    - **Code.** `inserts/spectrePresets.ts` holds the types,
      `applySpectrePreset` and `matchingSpectrePreset`. The presets are
      table data, one file per group, joined by `spectrePresetBank.ts`.
    - **How curves are written.** A preset's curves are short recipes
      (`spectreRecipes.ts`: flat, ramp, band, steps, comb, harmonics and a
      seeded scatter), turned into cells when the module loads. A test pins
      their cells.
    - **What a preset writes:** every sound field.
    - **What it leaves alone:** Mix, Output, Freeze's switch and the on/off
      switch stay the user's, and a preset clears the selection.
    - **Names.** The bank is named in the reverbs' register, after rave and
      early dance culture. No name repeats one of Windsor's or names a
      brand.
    - **Values.** Each preset demonstrates one idea the technique is known
      for. The values are Windsor's own.
    - **Defaults.** Bleep Test is the default, and a new Spectre takes its
      settings.

    | # | Name | Group | The idea it shows |
    |---|---|---|---|
    | 1 | Bleep Test | Drums | Delays in leveled steps on a 1/16 grid, longer up the spectrum: hats ratchet upward |
    | 2 | Hardcore Roll | Drums | Alternate cells on and off at 1/32 with middling feedback, so the snare rolls |
    | 3 | Shuffle Floor | Drums | Scatter on a 1/8-triplet grid: the loop swings band by band |
    | 4 | Speaker Stack | Drums | The gate modulation lets only the loud bands into a 1/8 echo |
    | 5 | Jungle Splice | Drums | Holes, with steps jumping between 1/16 and 3/16: the break re-cuts itself |
    | 6 | Bass Bin | Drums | Below 150 Hz a 1/4 echo with long feedback; above, dry: a dub on the kick |
    | 7 | Hype Man | Vocals & leads | A smooth delay ramp from 0 to 1/4, rising: a word climbs through its overtones |
    | 8 | Tannoy | Vocals & leads | A narrow gain band around 1–3 kHz, short combed delays: a PA in a hall |
    | 9 | Diva Melt | Vocals & leads | Blur and phase on long, smooth mid delays: a sung line smears into a chord |
    | 10 | Riser | Vocals & leads | The shift modulation, with the LFO sliding the delay curve upward |
    | 11 | Anthem | Vocals & leads | L and R unlinked, one delay ramp rising and the other falling: the line splits across the field |
    | 12 | Whistle Posse | Vocals & leads | Only the top two octaves, delayed in steps with high feedback: the brightness echoes on its own |
    | 13 | Prism | Pads & textures | A gain comb a third of an octave wide, slid slowly by the LFO: a spectral phaser |
    | 14 | Ring Road | Pads & textures | Very short delays, a comb of high feedback: metallic resonance in tune with nothing |
    | 15 | Lava Lamp | Pads & textures | Swell, with the LFO on the feedback offset: a pad that breathes |
    | 16 | Smiley | Pads & textures | A sieve of gain cells over smudge: a shimmer with gaps in it |
    | 17 | Warehouse | Pads & textures | Low bands long and fed back, highs cut and short: a big, dark room |
    | 18 | Dub Siren | Pads & textures | Shift with feedback near full: tones spiral up out of the sound |
    | 19 | Freeze Frame | Freeze & FX | Freeze in Hold over a steady delay map: catch a moment and hold it |
    | 20 | Tunnel Vision | Freeze & FX | Freeze in Carve, with feedback notches drawn in: the held sound narrows into a tunnel |
    | 21 | Mashed Up | Freeze & FX | Random cells, no grid, scatter up: the order comes apart |
    | 22 | Sweep the Floor | Freeze & FX | Two LFO slots, synced to a bar, sliding the delay and gain curves together |
    | 23 | Flashback | Freeze & FX | Delays falling with frequency and fed back: each hit cascades downward |
    | 24 | Rinse Out | Freeze & FX | Invert and holes on stepped feedback: harsh and torn |

### Format and cost

13. **Format: none.** Spectre hasn't merged to `main`, so no released song
    holds a breakpoint curve. A breakpoint curve from a local song made
    while Spectre was being built is sampled into cells, with a correction.
    The song stores each curve's values rounded to 1/1000, which the
    normaliser applies, so a round trip is exact.
14. **Cost should fall.** Reading a band becomes one lookup and one
    interpolation, where today it walks segments. Building the effective
    cells costs 3 × 180 adds a channel a frame. The scope's binning runs
    only while the workbench is open. The cost note is measured again.

## Deviation

The repo's UI rule mocks a new view from a screenshot and has it approved
before the build. tacowars asked for the modern version to be built
directly, so the workbench is built first and reviewed running
(`npm run dev`), with screenshots in the PR. Any change it needs comes as a
follow-up on this branch.

## Not done

- **Cells are not automation targets.** Their moves are, as before.
- **No A/B snapshots or morph.** A morph between two cell sets would make a
  strong performance control, and it can come later.
- **No per-band drawing finer than a cell.** At high resolutions several
  bands share a cell, which smooth reads hide.
