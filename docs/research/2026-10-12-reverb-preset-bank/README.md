# The Reverb's preset bank: measurements

windsor#774, item 8 of `docs/research/2026-10-11-plate-reverb-upgrades/`. The
decisions are in `docs/log/2026-10-12-reverb-preset-bank.md`; this note holds
the figures behind the bank's values. The values themselves are in
`packages/engine/src/inserts/reverbPresets{Everyday,Drums,Pads,Ambient}.ts`,
each with its group's figures in its header.

Every figure was read through `bankRig.mjs` on the shipped bundle
(`packages/engine/src/worklet/generated/reverb-processor.js`) at `main`
9f97532, which this change leaves untouched. Machine: Apple M1, 16 GB.
Backend: Node 24.21.0 (V8). No audio was written to the repo.

## How it is read

`node docs/research/2026-10-12-reverb-preset-bank/bankRig.mjs` prints the
table below. It reads the bank from the engine's table files (Node strips
their types) and loads the processor with the Build rig's `loadPlate`
(`docs/research/2026-10-12-plate-build/buildRig.mjs`). With `--wav <dir>`
it also writes each render, for a listen outside the repo.

- **At Mix 1, 48 kHz:** wet 1, dry 0, each preset's 17 fields as the
  processor's parameters (`voicing` as 0 or 1). The plate settles half a
  second at its Size before any input.
- **T30:** broadband, from the Schroeder integral of L² + R² after one
  click into both channels, fitted from −5 to −35 dB (`buildRig.mjs`'s
  `t30`).
- **Two materials,** each 2 s with a peak of −6 dBFS, synthesised by the
  rig with a fixed seed:
  - **drum loop:** one bar at 120 bpm, a kick on every beat, a snare on 2
    and 4, and closed hats on the off-beats, panned left and right in turn;
  - **pad chord:** A minor seventh (A3 C4 E4 G4), two detuned saws a note
    through a 2.5 kHz one-pole low-pass, 0.2 s attack and 0.3 s release.
- **Level:** the wet RMS over the whole render, the material then its
  tail: the pre-delay plus the nominal RT60 (Decay, or Decay × Low × when
  that is longer), capped at 12 s in all. A preset's level is read on its
  group's material, the drum loop for Everyday and Drums and the pad chord
  for Pads & leads and Ambient, and stated against Resident's on the same
  material. **Peak** is the wet sample peak on that material.
- **No sweep and no CPU figures:** the DSP does not change.

Resident on both materials: drum loop −30.9 dBFS RMS, peak −11.6 dBFS; pad
chord −19.4 dBFS RMS. The drum loop's RMS is mostly its kick, so the drum
presets' low cuts set most of their level.

## The bank

The aims are the note's §8 Decay column. The last two columns are each
preset's RMS on both materials, dBFS.

| # | Preset | Group | Voicing | Aim s | T30 s | vs aim | Material | Level vs Resident dB | Peak dBFS | Drums RMS | Pad RMS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Resident | Everyday | plate | 6.35 | 6.03 | −5 % | drums | 0.0 | −11.6 | −30.9 | −19.4 |
| 2 | House Plate | Everyday | plate | 1.6 | 1.54 | −4 % | drums | +0.7 | −12.0 | −30.3 | −17.1 |
| 3 | Main Room | Everyday | room | 1 | 1.02 | +2 % | drums | +0.6 | −13.9 | −30.3 | −20.4 |
| 4 | Back Room | Everyday | room | 0.6 | 0.58 | −3 % | drums | +0.9 | −12.2 | −30.0 | −20.3 |
| 5 | Warm-up | Everyday | plate | 1.1 | 1.06 | −3 % | drums | −0.6 | −14.2 | −31.5 | −19.1 |
| 6 | Booth | Everyday | room | 0.35 | 0.33 | −5 % | drums | −0.8 | −10.2 | −31.7 | −17.9 |
| 7 | Mic Check | Everyday | plate | 1 | 0.96 | −4 % | drums | −0.3 | −11.5 | −31.2 | −17.8 |
| 8 | Long Set | Everyday | plate | 3 | 2.84 | −5 % | drums | −0.5 | −12.5 | −31.4 | −18.6 |
| 9 | Dubplate | Drums | plate | 0.9 | 0.88 | −2 % | drums | +0.4 | −11.8 | −30.5 | −18.4 |
| 10 | Rewind | Drums | plate | 1.6 | 1.53 | −4 % | drums | −0.4 | −12.6 | −31.3 | −18.3 |
| 11 | Club Toilets | Drums | room | 0.6 | 0.57 | −5 % | drums | +0.8 | −10.0 | −30.2 | −16.8 |
| 12 | Railway Arch | Drums | room | 0.5 | 0.46 | −8 % | drums | −0.3 | −11.2 | −31.2 | −20.0 |
| 13 | Cloakroom | Drums | room | 1.2 | 1.17 | −3 % | drums | +0.9 | −12.0 | −30.1 | −19.5 |
| 14 | Stairwell | Drums | room | 1.3 | 1.29 | −1 % | drums | +0.3 | −14.1 | −30.6 | −20.1 |
| 15 | Sound Clash | Drums | plate | 1.2 | 1.17 | −2 % | drums | 0.0 | −11.6 | −31.0 | −19.0 |
| 16 | Acetate | Pads & leads | plate | 1.8 | 1.76 | −2 % | pad | +1.7 | −3.1 | −26.7 | −17.6 |
| 17 | White Label | Pads & leads | plate | 2.5 | 2.34 | −6 % | pad | +0.8 | −2.6 | −36.3 | −18.6 |
| 18 | Euphoria | Pads & leads | plate | 3.5 | 3.42 | −2 % | pad | −0.6 | −3.3 | −31.3 | −20.0 |
| 19 | Hands in the Air | Pads & leads | plate | 4 | 3.85 | −4 % | pad | +0.5 | −2.5 | −30.4 | −18.9 |
| 20 | Breakdown | Pads & leads | plate | 3 | 2.98 | −1 % | pad | −1.0 | −3.0 | −29.4 | −20.3 |
| 21 | Sunrise Set | Pads & leads | plate | 4 | 4.00 | 0 % | pad | −0.2 | −1.0 | −28.4 | −19.5 |
| 22 | Afters | Ambient | plate | 6 | 5.63 | −6 % | pad | −0.7 | −1.3 | −32.4 | −20.0 |
| 23 | Last Train | Ambient | plate | 8 | 7.30 | −9 % | pad | −0.8 | −1.3 | −30.8 | −20.2 |
| 24 | Comedown | Ambient | plate | 5 | 5.09 | +2 % | pad | −1.1 | −2.1 | −27.6 | −20.5 |
| 25 | Old Mill | Ambient | room | 4 | 3.85 | −4 % | pad | −1.9 | −3.3 | −28.7 | −21.3 |
| 26 | Lights Up | Ambient | plate | 5 | 4.73 | −5 % | pad | +0.4 | −1.6 | −29.4 | −18.9 |
| 27 | Sound System | Ambient | plate | 4 | 4.00 | 0 % | pad | −1.2 | −2.2 | −29.7 | −20.6 |

## Against the criteria

- **Every level is within ±2 dB of Resident's** on its group's material:
  from −1.9 dB (Old Mill) to +1.7 dB (Acetate).
- **Every T30 is within 10 % of its aim,** so none is a deviation under the
  issue's 20 % rule. The broadband T30 runs a little short of Decay where
  the tank's high cut is low, as `docs/research/2026-10-12-plate-decay-seconds/`
  measured; where a preset's low band rings longer than Decay (Rewind,
  Sunrise Set, Comedown, Sound System), Decay sits below the aim so the
  broadband T30 lands on it.
- **Resident** is the `hall` space field for field. Its aim is that space's
  tail: its Decay, 6.35 s, is the T30 `hall` measured before Decay became
  seconds (windsor#748), and it measures 6.03 s through today's processor.
- **Old Mill** is the closest to the level edge. At Size 4 the room's early
  field is sparse, and at Decay 3.8 s it read 2.6 dB under Resident on the
  pad with 1 ms of modulation depth. At 0.2 ms it reads 1.9 dB under. Build,
  tank diffusion, Decay and the cuts moved it less than the modulation
  depth did.
- **On the pad chord the level moves with Size,** and not always in one
  direction: at Build 0.3, Afters read −2.6, −1.7, −1.4 and −1.8 dB at
  Size 1.7, 1.6, 1.4 and 1.2. Acetate, Sunrise Set, Afters, Last Train,
  Comedown and Lights Up were brought into the window by Size, so their
  figures hold at the shipped values only.

## How the values were reached

Each preset started from the note's §7 starting point for its kind of space
and its §8 row. The rig measured it, and Decay was moved until the T30 sat
on the aim. Levels were then trimmed one field at a time:

- the input and tank low cuts on the drum material, raised from the first
  draft where a preset read loud and lowered where it read quiet;
- Size, Build and the low band on the pad material;
- Old Mill's modulation depth, the one lever left at Size 4.

They are now for tacowars's ear on the preview.

## The picker

`starting-point-picker.png`: the Mixer tab in headless Chrome at 1440×900,
with a new Reverb on the master reading Resident and Send A's Reverb on
Back Room. Headless Chrome draws no native menu, so the open list beside
them is a copy of Send A's picker drawn as a list box: the bank under its
four groups, in order.
