# windsor#301: operator envelope edges at their own samples

What the change costs and what it changes in the library. The decision is
`docs/log/2026-10-01-envelope-edges-at-sample-rate.md`.

**Dev-machine indication only.** Node renders through the shipped bundle,
not an `AudioWorkletGlobalScope` in Chrome. These are relative costs on one
machine (CLAUDE.md invariant 5).

## Machine and method

| | |
|---|---|
| Machine | Apple M1 (laptop, 8 cores), macOS 26.5.1 |
| Runtime | Node v24.21.0, V8 JIT, one process per measurement |
| Load | other sessions were running; the 1-minute load average read 2.4 to 6.6 |
| Bench | `bench.mjs` here: the shipped `fm-processor.js` of a checkout, evaluated as `scripts/sound-match/render.mjs` does. Two scenarios of four parts, 10 s each, a reading the median of 9 renders of the four after a warm-up |
| Pairs | `pairs.mjs` here: before and after alternate, one process each, in alternating order; the result is the median of the per-round ratios after / before |
| Before | `main` at `ac0fa91` (`git archive` of `packages/engine/src` and `scripts/sound-match`) |
| After | this branch on `ac0fa91` |

- `held`: the #548 / windsor#300 bench's parts (`pad-drift`, `horde-horn`,
  and `pickup-blip` and `hat` with every sustain raised to 0.7), three held
  notes each. After the first attacks no segment ends: the steady per-sample
  cost of the knot test.
- `hits`: `tr808-kick`, `tr808-clap`, `tr909-snare` and `tr909-hat-closed`,
  a hit every 125 ms gated 50 ms. Attacks, decays and releases end inside
  blocks on every hit, so the knots and the envelope's carry run throughout.

## Cost against main

| Scenario | Rounds | Before | After | Median ratio after / before | Per-round ratios |
|---|---|---|---|---|---|
| `held` | 10 | 346.6 ms | 358.4 ms | 1.015 | 1.00, 0.96, 1.03, 1.00, 1.00, 1.02, 1.03, 1.11, 1.09, 1.00 |
| `hits` | 10 | 97.2 ms | 101.3 ms | 1.040 | 1.07, 0.99, 1.03, 1.09, 0.96, 1.13, 1.05, 1.04, 1.02, 0.99 |

The held render costs about 1.5 % more, inside the rounds' scatter (0.96 to
1.11): one integer test per operator per sample. The drum hits cost about
4 % more: the envelope walks each segment end and the voice sets up to four
knots per operator per block. The allocation tests
(`synth/fmProcessorAllocation.test.ts`) pass: the first version kept the
envelope's remaining samples in a loop-carried local, which V8 boxed on
every segment end (about 3 KB per 800 quanta in the burst run), so it lives
in a field.

## The 808 kick against its recording

`scripts/sound-match/compare.py`, `tr808-kick` (unchanged, not refitted)
against `808 From Mars` `A/BD A 808 Decay C 06.wav`, C4, velocity 1:

| | 0–5 ms above 2 kHz | 0–5 ms 2–6 kHz | 0–5 ms above 6 kHz | Click peak above 1 kHz, 0–10 ms |
|---|---|---|---|---|
| Before (main) | −20.7 dB | −19.2 dB | −33.7 dB | −20.1 dB re peak (recording −5.3) |
| After | −18.9 dB | −17.4 dB | −34.2 dB | −19.9 dB re peak |

1.8 dB closer above 2 kHz. The patch was fitted under the old floor: its
edge operator (C, a `Square D` at 36–46 Hz) has the default 0.5 ms attack
and a 0.52 ms decay, about 49 samples now where it took 64. A refit that
uses an attack of 0 and a sub-millisecond decay is what the faster edge
makes possible; it is not part of this change.

## Every library patch

`library_diff.py` here renders each patch in `packages/engine/src/patches/`
on both checkouts through `scripts/sound-match/render.mjs`: C4 (the
percussion note), velocity 1, seed 1, 2 s, note-off at 0.5 s. The peak
absolute difference is the largest sample difference (linear, and in dB
against the before render's peak; a short envelope moved by a fraction of a
millisecond under a fast oscillator or noise reads as a large difference
with no change in level). The last column is the change in level above
2 kHz over the first 5 ms from the note-on, as `compare.py` sums its high
bands.

```
python library_diff.py <before root> <after root> [out.json]
```

164 patches: 119 changed, 45 bit-identical (rerun against `main` at
`c84a7ef`, after the TR percussion refits of windsor#310, which added
`tr909-tom-mid`). Every change follows from
decision 1: an operator segment shorter than a block (the 0.5 ms default
attack among them) now ends at its own sample, and a longer segment that
ends inside a block lands there too, so the next one starts on time. The
second kind moves the pads and score patches at the bottom of the table by
−40 dB and less. The bit-identical patches end no operator segment inside a
block in this render.

| Patch | Peak abs. difference | re its peak | Above 2 kHz, 0–5 ms |
|---|---|---|---|
| `build-thunk` | 0.9911 | +1.7 dB | +0.4 dB |
| `lead-bell` | 0.8103 | +1.1 dB | +0.2 dB |
| `efm-kick` | 0.6461 | +1.3 dB | -1.4 dB |
| `efm-zap` | 0.5805 | -0.0 dB | -0.0 dB |
| `efm-crash` | 0.5755 | -0.4 dB | +0.1 dB |
| `bass-digital` | 0.5361 | -2.4 dB | -0.0 dB |
| `efm-hat-closed` | 0.4611 | -2.9 dB | +0.2 dB |
| `score-dry-ticker` | 0.4547 | -0.6 dB | -0.0 dB |
| `weapon-zap` | 0.4449 | -4.2 dB | +0.3 dB |
| `efm-hat-open` | 0.3578 | -2.3 dB | +0.1 dB |
| `score-hollow-droplet` | 0.3283 | +2.1 dB | -0.2 dB |
| `efm-tom` | 0.3185 | -5.1 dB | -0.6 dB |
| `score-bronze-rain` | 0.2637 | +0.1 dB | +0.5 dB |
| `efm-clap` | 0.2550 | -6.1 dB | +0.6 dB |
| `efm-rim` | 0.2452 | -5.9 dB | -0.3 dB |
| `tr909-hat-open` | 0.2434 | -4.8 dB | +0.0 dB |
| `tr909-hat-closed` | 0.2390 | -2.6 dB | -0.2 dB |
| `score-wire-harp` | 0.2371 | -0.8 dB | -0.1 dB |
| `score-data-fragments` | 0.2343 | -1.3 dB | +0.0 dB |
| `efm-snare` | 0.2082 | -9.7 dB | -0.3 dB |
| `score-corrupt-clock` | 0.2036 | -3.2 dB | -0.0 dB |
| `pickup-blip` | 0.2021 | -10.9 dB | +0.0 dB |
| `score-ice-needle` | 0.1948 | -3.0 dB | +0.1 dB |
| `snare` | 0.1753 | -12.1 dB | +0.1 dB |
| `efm-bell-perc` | 0.1672 | -9.7 dB | -0.1 dB |
| `tr909-ride` | 0.1563 | -8.6 dB | +0.1 dB |
| `score-shortwave-chord` | 0.1328 | -4.6 dB | +0.0 dB |
| `score-tin-kalimba` | 0.1300 | -5.9 dB | +0.1 dB |
| `tr808-clave` | 0.1284 | -13.4 dB | -0.1 dB |
| `tr808-conga` | 0.1032 | -14.7 dB | +1.2 dB |
| `tr909-kick-short` | 0.1006 | -16.5 dB | -1.9 dB |
| `tr909-kick-long` | 0.0976 | -16.6 dB | -2.2 dB |
| `score-tunnel-growl` | 0.0973 | -6.0 dB | -0.0 dB |
| `tr909-kick-hard` | 0.0969 | -16.9 dB | -1.3 dB |
| `tr909-kick` | 0.0952 | -16.8 dB | -1.9 dB |
| `score-wooden-pin` | 0.0946 | -8.3 dB | +0.3 dB |
| `kick` | 0.0943 | -16.8 dB | +2.6 dB |
| `tr808-tom-high` | 0.0854 | -13.4 dB | +1.2 dB |
| `tr808-tom-low` | 0.0839 | -13.5 dB | +1.2 dB |
| `tr909-crash` | 0.0833 | -14.6 dB | +0.2 dB |
| `tr808-tom-mid` | 0.0741 | -14.7 dB | +0.3 dB |
| `tr909-rimshot` | 0.0731 | -14.9 dB | -0.5 dB |
| `score-glass-pebble` | 0.0711 | -10.8 dB | +0.2 dB |
| `tr909-tom-mid` | 0.0706 | -16.8 dB | +0.4 dB |
| `tr909-tom-low` | 0.0690 | -17.0 dB | +0.4 dB |
| `tr808-kick` | 0.0675 | -19.1 dB | +1.3 dB |
| `tr909-tom-high` | 0.0664 | -17.6 dB | +0.5 dB |
| `tr808-kick-long` | 0.0565 | -20.7 dB | +0.5 dB |
| `score-night-rubber` | 0.0561 | -12.2 dB | +0.0 dB |
| `score-iron-root` | 0.0540 | -10.3 dB | +0.7 dB |
| `tr808-rimshot` | 0.0537 | -16.1 dB | -0.1 dB |
| `tr808-hat-closed` | 0.0528 | -12.7 dB | +0.2 dB |
| `tr909-snare` | 0.0518 | -18.0 dB | +0.1 dB |
| `tr808-snare` | 0.0517 | -18.1 dB | +0.0 dB |
| `hat` | 0.0480 | -17.7 dB | +0.1 dB |
| `tr808-kick-short` | 0.0448 | -22.3 dB | +6.6 dB |
| `efm-cowbell` | 0.0447 | -20.0 dB | +0.1 dB |
| `tr808-hat-open` | 0.0443 | -16.4 dB | +0.2 dB |
| `saw-arp` | 0.0436 | -18.8 dB | +0.1 dB |
| `tr808-cymbal` | 0.0393 | -16.6 dB | +0.3 dB |
| `score-concrete-chord` | 0.0384 | -14.7 dB | -0.0 dB |
| `tr808-clap` | 0.0369 | -19.2 dB | +0.0 dB |
| `tr808-maracas` | 0.0367 | -17.0 dB | +0.0 dB |
| `ai-voice` | 0.0295 | -27.5 dB | +0.0 dB |
| `score-copper-step` | 0.0271 | -17.1 dB | -0.2 dB |
| `tr909-clap` | 0.0265 | -21.4 dB | +0.0 dB |
| `score-graphite-bass` | 0.0234 | -20.9 dB | -0.4 dB |
| `score-amber-stab` | 0.0214 | -20.3 dB | +0.1 dB |
| `drone-sqr` | 0.0145 | -30.8 dB | -0.0 dB |
| `score-dockside-bass` | 0.0115 | -25.2 dB | +0.0 dB |
| `score-last-light-bell` | 0.0081 | -29.2 dB | -0.0 dB |
| `score-engine-pulser` | 0.0075 | -35.7 dB | +0.0 dB |
| `score-high-tremolo` | 0.0037 | -34.2 dB | +0.0 dB |
| `score-quick-downwash` | 0.0034 | -32.0 dB | +0.0 dB |
| `score-felt-circuit` | 0.0029 | -38.1 dB | -0.0 dB |
| `tr808-cowbell` | 0.0023 | -41.0 dB | -0.0 dB |
| `str-edm-stab` | 0.0017 | -42.4 dB | -0.0 dB |
| `score-round-foundation` | 0.0012 | -46.2 dB | -0.0 dB |
| `score-long-downwash` | 0.0011 | -40.3 dB | +0.0 dB |
| `score-wire-harmonics` | 0.0005 | -53.3 dB | +0.0 dB |
| `score-dry-relay` | 0.0004 | -54.4 dB | +0.0 dB |
| `lead-width-sweep` | 0.0004 | -57.1 dB | -0.0 dB |
| `score-warm-pressure` | 0.0004 | -53.2 dB | +0.0 dB |
| `str-d50-glass` | 0.0003 | -56.1 dB | +0.0 dB |
| `score-rubber-key` | 0.0002 | -60.1 dB | +0.0 dB |
| `score-soft-undertow` | 0.0002 | -62.6 dB | +0.0 dB |
| `score-slow-beacon` | 0.0001 | -71.1 dB | +0.0 dB |
| `score-silk-swish` | 0.0001 | -61.9 dB | +0.0 dB |
| `score-estuary-violas` | 0.0001 | -64.2 dB | +0.0 dB |
| `score-soft-machinery` | 0.0001 | -64.8 dB | +0.0 dB |
| `score-faded-neon` | 0.0001 | -68.3 dB | +0.0 dB |
| `score-salt-violins` | 0.0001 | -67.5 dB | +0.0 dB |
| `score-granular-hiss` | 0.0001 | -67.1 dB | +0.0 dB |
| `score-violet-section` | 0.0000 | -73.2 dB | +0.0 dB |
| `score-silver-dust` | 0.0000 | -76.5 dB | +0.0 dB |
| `score-carbon-reed` | 0.0000 | -82.3 dB | +0.0 dB |
| `str-supersaw-trance` | 0.0000 | -80.8 dB | +0.0 dB |
| `score-silt-pulse-bass` | 0.0000 | -84.5 dB | +0.0 dB |
| `score-muted-chamber` | 0.0000 | -85.6 dB | +0.0 dB |
| `score-drowned-cellos` | 0.0000 | -85.7 dB | +0.0 dB |
| `score-velvet-airlock` | 0.0000 | -79.6 dB | +0.0 dB |
| `score-afterimage-quartet` | 0.0000 | -93.7 dB | +0.0 dB |
| `score-low-tremolo` | 0.0000 | -90.5 dB | +0.0 dB |
| `score-low-transformer` | 0.0000 | -100.4 dB | +0.0 dB |
| `score-muted-cable` | 0.0000 | -99.5 dB | +0.0 dB |
| `score-rusted-tine` | 0.0000 | -124.5 dB | +0.0 dB |
| `score-sine-weight` | 0.0000 | -130.1 dB | +0.0 dB |
| `score-hollow-anchor` | 0.0000 | -130.3 dB | +0.0 dB |
| `score-felt-sub` | 0.0000 | -130.9 dB | +0.0 dB |
| `score-velvet-offbeat` | 0.0000 | -147.2 dB | +0.0 dB |
| `score-broken-relay` | 0.0000 | -177.9 dB | +0.0 dB |
| `score-porcelain-drop` | 0.0000 | -178.4 dB | +0.0 dB |
| `score-buffer-drift` | 0.0000 | -193.6 dB | +0.0 dB |
| `score-submerged-keys` | 0.0000 | -190.4 dB | +0.0 dB |
| `str-solina-ensemble` | 0.0000 | -190.3 dB | +0.0 dB |
| `str-jp8-strings` | 0.0000 | -196.6 dB | +0.0 dB |
| `score-moss-stab` | 0.0000 | -203.7 dB | +0.0 dB |
| `score-bright-air-riser` | 0.0000 | -192.3 dB | +0.0 dB |
| `score-slow-air-riser` | 0.0000 | -197.6 dB | +0.0 dB |

Bit-identical: `horde-horn`, `pad-drift`, `score-amber-ceiling`, `score-ash-cathedral`, `score-black-ice-strings`, `score-black-resonator`, `score-blue-vapour`, `score-breathing-rosin`, `score-buried-voices`, `score-deep-current`, `score-deep-static`, `score-distant-gantry`, `score-empty-station`, `score-frozen-bow`, `score-ghost-formants`, `score-glass-horizon`, `score-harbour-fog`, `score-hollow-bows`, `score-hollow-ticker`, `score-long-dusk`, `score-low-weather`, `score-magnetic-veil`, `score-narrow-riser`, `score-night-choir`, `score-open-sea`, `score-pale-monolith`, `score-passing-vapour`, `score-polar-bloom`, `score-quiet-reactor`, `score-radio-dust`, `score-remote-orchestra`, `score-rust-ensemble`, `score-silt-contrabass`, `score-stone-marimba`, `score-suspended-steel`, `score-tape-halo`, `score-tidal-memory`, `score-underwater-room`, `score-uneasy-scale`, `score-vent-breath`, `score-wire-stress`, `str-ambient-evolve`, `str-juno-strings`, `str-ob-strings`, `sub-drone`

## Rerun

From the repository root, with Node 24 and the sound-match venv
(`scripts/sound-match/README.md`):

```
git archive <before> packages/engine/src scripts/sound-match | tar -x -C /tmp/before
node docs/research/2026-10-01-fast-envelope-edges/pairs.mjs /tmp/before . 10 held,hits
python docs/research/2026-10-01-fast-envelope-edges/library_diff.py /tmp/before .
```

A quiet-machine rerun would tighten the cost figures.
