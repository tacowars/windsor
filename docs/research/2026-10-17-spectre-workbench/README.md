# Spectre's workbench and presets

The research behind record `2026-10-17-spectre-drawn-cells`: what the
workbench looks like running, and how the preset bank was voiced. No audio is
kept here.

## The workbench, running

Screenshots from the dev server in headless Chrome at 1440 × 900.

- `card.png`: the rack card's Curves page on Bleep Test, with the three lanes
  in miniature, the Starting point picker and Expand.
- `workbench-shape.png`: the workbench after a Draw stroke across the gain
  lane and a selection dragged on the feedback lane (tinted across all three
  lanes). Harmonics is previewing as a ghost within the selection, with
  Apply lit.
- `workbench-follow.png`: an arp playing, with Follow on Chord. The live
  spectrum (input filled, output as a line) sits behind every lane, and the
  harmony track's chord tones are tinted in every octave, lining up with the
  arp's partials.

Checked by hand on the same run:
- Apply and undo each make one named step ("Spectre Shape", "Spectre
  selection").
- The readout names the band, its note and each lane's value.
- The console stayed free of errors and warnings.

## Voicing the presets

`presetRig.ts` renders each preset at Mix 1, 48 kHz, through the worklet's own
`SpectreDsp`, with the cells loaded as the processor loads them. It renders
each preset on its group's material, 2 s of it then 2 s of tail:
- **Drums** and **Freeze & FX**: a drum loop.
- **Vocals & leads**: a sung-like line.
- **Pads & textures**: a pad chord.

```
npx esbuild docs/research/2026-10-17-spectre-workbench/presetRig.ts --bundle \
  --platform=node --format=esm --outfile=/tmp/spectre-rig.mjs && node /tmp/spectre-rig.mjs
```

The level rule is the Reverb bank's: each preset's wet RMS sits within ±2 dB
of its group's first. Trims went in three ways:
- **The gain cells.** `trim` in `spectreRecipes.ts` lowers them by dB, along
  the gain curve's 60 dB span.
- **The feedback.** Bass Bin, Dub Siren and Tunnel Vision built up past
  0 dBFS at first. Tunnel Vision is the clearest case: at full feedback
  without Freeze it ran away, so its "held" bands sit at 0.96.
- **The bands.** Whistle Posse's and Sweep the Floor's bands were widened to
  where the materials have energy.

Every preset now sits within the rule. The loudest peak is Bleep Test's, at
−1.9 dBFS. Each group's table file lists its presets' levels in its header.
