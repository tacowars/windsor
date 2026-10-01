# Each Tape model gets its own magnetic row

- **Date:** 2026-10-01
- **Issue:** [windsor#289](https://github.com/tacowars/windsor/issues/289)
- **Follows:** [the integration design](2026-09-30-tape-magnetic-integration-design.md)
  (decision 6), [the integration](2026-09-30-tape-magnetic-integration.md),
  [the greenfield direction](2026-09-30-tape-greenfield-direction.md)

## Decision

Until now every row of `TAPE_MODELS` carried the research centre,
`magnetic: [0.5, 0.5, 0.5]`, so the seven models differed in EQ, hiss and
wear but saturated the same way. tacowars delegated the choice of rows to a
researched best guess: what each tape technology does, mapped onto the
core's three controls. The rows are a default for tacowars to check by ear on
the preview, not a measured emulation of any machine or tape stock.

Each row is one of the 25 points the
[dynamic-survival record](2026-09-30-tape-dynamic-survival.md) sampled
above the susceptibility floor, as design decision 6 requires: all seven
are interior points of its edits schedule, written as the exact doubles
`mulberry32` drew with seed 204. `inserts/tapeModelRows.test.ts` regenerates
the schedule and holds each row to its point. The labels below round them
to two decimals.

| Model | Row (drive / width / saturation) | Why |
|---|---|---|
| 30ips Studio | 0.16 / 0.28 / 0.32 | The fastest professional speed: the most headroom and the least distortion, so a gentle shape, a narrow loop and a high ceiling. |
| Ferric (Type I) | 0.72 / 0.51 / 0.59 | The lowest remanence of the cassette types, so it compresses earlier and sounds warm. |
| Vintage | 0.74 / 0.83 / 0.53 | An older, looser formulation: a wide, smeary loop. |
| 15ips Studio | 0.55 / 0.59 / 0.56 | Half the speed of 30ips: thicker and smoother, and it compresses when pushed. |
| Chrome (Type II) | 0.34 / 0.13 / 0.56 | Higher coercivity than ferric: a tight, clean loop. |
| Metal (Type IV) | 0.34 / 0.49 / 0.13 | Three to four times the remanence of oxide tape: the highest output before saturation, so the highest ceiling. |
| VHS (linear track) | 0.84 / 0.77 / 0.97 | A narrow linear audio track at about 1.3 ips: early, heavy level compression and audible distortion. |

How the controls act, for reading the table: drive sets the shape
`a = Ms / (0.01 + 6 · drive)` (higher bends sooner), width sets the
reversible fraction `c = √(1 − width) − 0.01` (higher is a wider, more
irreversible loop), and saturation sets the ceiling
`Ms = 0.5 + 1.5 · (1 − saturation)` (higher tops out lower). The output is
normalised to unity small-signal gain, so a row changes the character of
loud material, not the level of quiet material.

### Sources

- [Compact Cassette tape types and formulations](https://en.wikipedia.org/wiki/Compact_Cassette_tape_types_and_formulations),
  Wikipedia: the coercivity and remanence figures. Type I ferric is about
  360 Oe (IEC reference) with a remanence of about 1100 G for basic ferric
  tape and about 1600 G for microferric. Type II chrome is about 490 Oe
  (reference) with about 1650 G. Type IV metal is about 1100 Oe with
  3000–3500 G, and the article credits metal particles with "3–4 times
  higher remanence" than oxide particles, and with "the widest dynamic
  range coupled with the lowest distortion".
- [Reel-to-reel audio tape recording](https://en.wikipedia.org/wiki/Reel-to-reel_audio_tape_recording),
  Wikipedia: for speed. "In general, the faster the speed, the better the
  reproduction quality"; 15 ips is the professional music speed and 30 ips
  is used "where the best possible treble response and lowest noise floor
  are demanded".
- [VHS](https://en.wikipedia.org/wiki/VHS), Wikipedia: for the linear
  audio track. Standard Play runs at 3.335 cm/s (1.313 ips) for NTSC, with
  "a mediocre frequency response of roughly 100 Hz to 10 kHz" and a
  signal-to-noise ratio of about 42 dB. The roughly 5% distortion figure in
  windsor#289 is the issue's own characterisation; the article does not
  give one.

## Measurement

Each row alone in the magnetic core: the `TapeOversampler` pair at 2× and
48 kHz, with no Bias, model EQ, DC block, motion or hiss, and Drive at 0
(a source-field gain of 1). The input is a 1 kHz sine at -12, -6 and
0 dBFS. After a quarter second, fifty whole cycles are read with a DFT at
the harmonic bins. THD is the RMS of harmonics 2 to 23 over the
fundamental. Gain is the fundamental's level in dB relative to the input:
negative is compression, positive is expansion. A -40 dBFS tone reads
within 0.06 dB of unity on every row. `inserts/tapeModelCharacter.test.ts`
holds this table to the shipped rows. The figures come from portable
arithmetic (`tapePortableMath.ts`), so they are the same on arm64 and x64.

| Model | THD -12 dBFS | THD -6 dBFS | THD 0 dBFS | Gain -12 dBFS | Gain -6 dBFS | Gain 0 dBFS |
|---|---|---|---|---|---|---|
| 30ips Studio | 0.54% | 0.95% | 1.58% | +0.20 dB | +0.42 dB | +0.72 dB |
| Chrome | 0.29% | 1.19% | 4.36% | +0.01 dB | −0.12 dB | −0.74 dB |
| Metal | 1.15% | 1.97% | 3.50% | +0.43 dB | +0.86 dB | +1.36 dB |
| 15ips Studio | 1.44% | 3.38% | 8.91% | +0.44 dB | +0.61 dB | +0.16 dB |
| Ferric | 1.40% | 4.72% | 12.27% | +0.10 dB | −0.30 dB | −1.78 dB |
| Vintage | 3.41% | 6.22% | 12.17% | +1.27 dB | +2.07 dB | +2.16 dB |
| VHS | 5.24% | 12.27% | 20.32% | −0.54 dB | −1.99 dB | −4.36 dB |
| *centre (old rows)* | 1.09% | 2.60% | 7.36% | +0.33 dB | +0.46 dB | +0.05 dB |

The expected order from clean to dirty was 30ips Studio, Chrome, Metal,
15ips Studio, Ferric, Vintage, VHS. By THD at -6 dBFS that is exactly what
was measured. At the other levels, neighbours trade places:

- At 0 dBFS, Metal (3.50%) is cleaner than Chrome (4.36%), and Ferric
  (12.27%) and Vintage (12.17%) are level.
- At -12 dBFS, Chrome (0.29%) is cleaner than 30ips Studio (0.54%), and
  Ferric (1.40%) is a hair under 15ips Studio (1.44%).

None of these is a material departure from the intended order, so the rows
stand as chosen. For level, the rows split in two. VHS, Ferric and Chrome
compress at 0 dBFS (−4.4, −1.8 and −0.7 dB). The others gain level as the
loop widens before they saturate: Vintage most (+2.2 dB at 0 dBFS), then
Metal, which fits its highest output before saturation. That expansion is
the irreversible part of the loop adding to the reversible slope. It is
part of the core's character, not a fault, but tacowars should know of it
when judging Vintage's level by ear.

## Live switching

The test design decision 6 asked for when rows first differ is
`inserts/tapeModelSwitch.test.ts`. It runs every ordered pair of models at
2× and 4×, at 44.1, 48 and 96 kHz, under a full-scale tone, through the
whole shipped path, and records no core reset.

The first version of this change reconfigured the core once per 128-sample
block, as decision 6 then said. Each block stepped the core's coefficients
and normalisation, and a step near a crest overshot: up to 1.075 of the
larger steady peak in the test's walk, and 1.093 with the EQ bypassed. The
stage now glides the controls and retunes the active cores every sample
while they move, and snaps to the row exactly when they arrive, so a settled
render is unchanged to the bit. With that, the walk's worst sample is 1.0213
of the larger steady peak and its lowest cycle peak 0.9599 of the smaller.
Those excursions are the glide's intermediate states, not steps: frozen
partway, the whole path's steady peak sits up to 1.4% above the larger end
(Ferric to Metal) and 1.3% below the smaller (30ips Studio to Vintage). The
test allows the measured excursions plus half a point. The design record's
[amendment to decision 6](2026-09-30-tape-magnetic-integration-design.md)
has the figures, and is where the tolerance is decided.

## Format

Nothing is bumped. Old songs sound different on every model, but the
greenfield direction waives old-song parity, and no field changes its
meaning.

## What follows

The Advanced panel ticket lets users move the three controls themselves,
starting from these rows. The design record already allows distinct rows;
this change amends its decision 6 for the per-sample glide and the
live-switch tolerance, as above.
