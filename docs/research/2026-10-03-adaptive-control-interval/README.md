# windsor#326: each voice's control interval from its state

What the change saves and what it changes in the library. The decision is
`docs/log/2026-10-03-adaptive-control-interval.md`.

**Dev-machine indication only.** Node renders through the shipped bundle,
not an `AudioWorkletGlobalScope` in Chrome. These are relative costs on one
machine (CLAUDE.md invariant 5).

## Machine and method

| | |
|---|---|
| Machine | Apple M1 (laptop, 8 cores, 16 GB), macOS 26.7.1 |
| Runtime | Node v24.21.0, V8 JIT, one process per measurement; no browser, no audio backend |
| Load | other sessions were running; the 1-minute load average read 2.0 to 5.7 |
| Bench | `bench.mjs` here: windsor#301's bench with a `pads` scenario added. The shipped `fm-processor.js` of a checkout, evaluated as `scripts/sound-match/render.mjs` does. Three scenarios of four parts, 10 s each; a reading is the median of 9 renders of the four after a warm-up |
| Pairs | `pairs.mjs` here: before and after alternate, one process each, in alternating order, 10 rounds; the result is the median of the per-round ratios after / before |
| Before | `main` at `64761dd` (`git archive` of `packages/engine/src` and `scripts/sound-match`), its shipped bundle |
| After | this branch on `64761dd`, its rebuilt bundle |

- `held`: the #548 / windsor#300 bench's parts (`pad-drift`, `horde-horn`,
  and `pickup-blip` and `hat` with every sustain raised to 0.7), three held
  notes each.
- `hits`: `tr808-kick`, `tr808-clap`, `tr909-snare` and
  `tr909-hat-closed`, a hit every 125 ms gated 50 ms.
- `pads`: `pad-drift`, `horde-horn`, and the song
  `pulses-for-eighteen-tapes`'s `m18-breath-choir` and `m18-tape-air`
  (`m18-pads.json` here, the song's own snapshots), a three-note chord every
  64 ms held 32 ms, at 12 voices a part: each part sits at its voice limit
  with nearly every voice in its release, stealing as it goes.

## Cost against main

| Scenario | Rounds | Before | After | Median ratio after / before | Per-round ratios |
|---|---|---|---|---|---|
| `held` | 10 | 244.0 ms | 180.2 ms | 0.750 | 0.75, 0.77, 0.76, 0.75, 0.73, 0.84, 0.74, 0.73, 0.73, 0.75 |
| `hits` | 10 | 167.9 ms | 168.2 ms | 1.005 | 1.01, 1.03, 0.98, 1.00, 1.00, 1.00, 1.00, 0.99, 1.06, 1.01 |
| `pads` | 10 | 1302.7 ms | 1007.6 ms | 0.724 | 0.70, 0.72, 0.90, 0.73, 0.68, 0.71, 0.70, 0.79, 0.75, 0.72 |

- `pads` costs about 28 % less, inside the issue's expected 20 to 30 %.
- `hits` is within the rounds' scatter (0.98 to 1.06): the drums stay in
  the fine interval and their renders are bit-identical, so the rule's
  reads at each boundary cost nothing measurable.
- `held` costs about 25 % less. Its notes sit in their sustains with slow
  or no LFOs after the first attacks, so they take the long interval too:
  a finding beyond the issue's two expectations, in the direction it
  intended.

## Every library patch

`../2026-10-01-fast-envelope-edges/library_diff.py` (windsor#301's,
unchanged) renders each patch in `packages/engine/src/patches/` on both
checkouts: C4, velocity 1, seed 1, 2 s, note-off at 0.5 s. The peak
absolute difference is the largest sample difference (linear, and in dB
against the before render's peak); the next column is the change in level
above 2 kHz over the first 5 ms from the note-on; the last says whether
every operator's attack is under 0.1 s, the patches whose 0–5 ms column
must read 0.0 dB (their attacks are fine by the rule).

```
python ../2026-10-01-fast-envelope-edges/library_diff.py <before root> <after root> [out.json]
```

166 patches against `main` at `64761dd`: 113 changed, 53 bit-identical.
Every TR drum, every `efm-*` drum and both FM hats are bit-identical (in
Loop or Trigger mode, or short throughout), and so are the "ticker" and
"clock" patches whose square or sample-and-hold LFOs jump on an operator's
level, which the rule keeps fine (the decision record's first clause
beyond the issue). Under the issue's rule alone those six moved the most,
up to 0.61 peak absolute difference (`score-hollow-ticker`), because a
long block stretched each jump's ramp from 32 samples to 128.

Every patch whose attacks are all under 0.1 s reads 0.0 dB in the 0–5 ms
column (51 changed patches, the largest change 0.014 dB). Five patches with
a slower attack move by 0.06 to 0.14 dB there (`score-afterimage-quartet`,
`score-low-tremolo`, `str-juno-strings`, `score-quiet-reactor`,
`score-muted-chamber`).

The peak differences at the top of the table are phase, not level: a
modulator at full index (`score-bronze-rain`), or a pitch LFO or glide
sampled every 2.7 ms instead of 0.67 (`horde-horn`, `ai-voice`), moves the
waveform while the level holds. A second pass over the eight largest
(`levels.py` here: 50 ms windows,
third-octave bands from 100 Hz within 40 dB of each window's loudest)
reads their 50 ms RMS level within 0.03 to 0.47 dB of `main`. Their band
levels hold within 0.2 to 1.8 dB, except two: `horde-horn` (5.5 dB) and
`score-bronze-rain` (8.9 dB) in a quiet band of some window, where a
beating between detuned or high-index operators falls at another moment.
These two, with the pads the issue names, are the listen's.

| Patch | Peak abs. difference | re its peak | Above 2 kHz, 0–5 ms | Every attack under 0.1 s |
|---|---|---|---|---|
| `score-bronze-rain` | 0.3600 | +2.8 dB | -0.0 dB | yes |
| `horde-horn` | 0.2590 | -11.2 dB | +0.0 dB | no |
| `ai-voice` | 0.2304 | -9.6 dB | +0.0 dB | no |
| `bass-digital` | 0.0920 | -17.8 dB | +0.0 dB | yes |
| `lead-bell` | 0.0560 | -22.2 dB | +0.0 dB | yes |
| `score-wire-stress` | 0.0302 | -19.3 dB | +0.0 dB | no |
| `score-shortwave-chord` | 0.0271 | -18.4 dB | +0.0 dB | yes |
| `weapon-zap` | 0.0206 | -30.7 dB | +0.0 dB | yes |
| `score-high-tremolo` | 0.0178 | -20.5 dB | +0.0 dB | no |
| `drone-sqr` | 0.0156 | -30.2 dB | +0.0 dB | yes |
| `score-iron-root` | 0.0150 | -21.4 dB | -0.0 dB | yes |
| `score-uneasy-scale` | 0.0133 | -23.2 dB | -0.0 dB | no |
| `build-thunk` | 0.0129 | -35.5 dB | +0.0 dB | yes |
| `score-low-transformer` | 0.0122 | -25.7 dB | -0.0 dB | yes |
| `score-silt-pulse-bass` | 0.0121 | -24.8 dB | +0.0 dB | yes |
| `score-rust-ensemble` | 0.0116 | -19.5 dB | +0.0 dB | no |
| `str-edm-stab` | 0.0107 | -26.4 dB | +0.0 dB | yes |
| `score-rubber-key` | 0.0097 | -27.0 dB | +0.0 dB | yes |
| `score-rusted-tine` | 0.0083 | -30.0 dB | -0.0 dB | yes |
| `score-hollow-anchor` | 0.0082 | -29.0 dB | +0.0 dB | yes |
| `score-graphite-bass` | 0.0081 | -30.2 dB | -0.0 dB | yes |
| `score-amber-stab` | 0.0068 | -30.3 dB | -0.0 dB | yes |
| `score-concrete-chord` | 0.0068 | -29.7 dB | -0.0 dB | yes |
| `score-tunnel-growl` | 0.0065 | -29.4 dB | -0.0 dB | yes |
| `score-estuary-violas` | 0.0064 | -28.3 dB | +0.0 dB | no |
| `score-copper-step` | 0.0060 | -30.2 dB | +0.0 dB | yes |
| `score-carbon-reed` | 0.0059 | -31.0 dB | +0.0 dB | yes |
| `score-night-rubber` | 0.0058 | -31.9 dB | +0.0 dB | yes |
| `score-suspended-steel` | 0.0055 | -23.6 dB | -0.0 dB | no |
| `score-low-tremolo` | 0.0050 | -28.4 dB | +0.1 dB | no |
| `score-tin-kalimba` | 0.0046 | -35.0 dB | -0.0 dB | yes |
| `score-sine-weight` | 0.0042 | -35.1 dB | -0.0 dB | yes |
| `score-dockside-bass` | 0.0041 | -34.2 dB | -0.0 dB | yes |
| `score-felt-sub` | 0.0037 | -36.0 dB | +0.0 dB | yes |
| `score-muted-cable` | 0.0032 | -33.6 dB | -0.0 dB | yes |
| `score-hollow-droplet` | 0.0032 | -38.1 dB | -0.0 dB | yes |
| `score-faded-neon` | 0.0032 | -36.9 dB | -0.0 dB | no |
| `score-round-foundation` | 0.0032 | -38.0 dB | +0.0 dB | yes |
| `score-soft-machinery` | 0.0031 | -35.0 dB | +0.0 dB | no |
| `score-breathing-rosin` | 0.0030 | -24.7 dB | +0.0 dB | no |
| `str-juno-strings` | 0.0028 | -35.1 dB | -0.1 dB | no |
| `pad-drift` | 0.0028 | -41.5 dB | -0.0 dB | no |
| `score-moss-stab` | 0.0028 | -38.0 dB | +0.0 dB | yes |
| `score-magnetic-veil` | 0.0027 | -28.9 dB | +0.0 dB | no |
| `score-salt-violins` | 0.0025 | -37.9 dB | +0.0 dB | no |
| `score-radio-dust` | 0.0024 | -35.6 dB | +0.0 dB | yes |
| `score-soft-undertow` | 0.0023 | -40.9 dB | +0.0 dB | yes |
| `score-wire-harmonics` | 0.0020 | -41.3 dB | +0.0 dB | no |
| `score-glass-pebble` | 0.0019 | -42.2 dB | +0.0 dB | yes |
| `score-velvet-offbeat` | 0.0019 | -39.1 dB | +0.0 dB | yes |
| `score-porcelain-drop` | 0.0018 | -43.4 dB | -0.0 dB | yes |
| `score-silk-swish` | 0.0017 | -37.8 dB | +0.0 dB | yes |
| `str-d50-glass` | 0.0017 | -41.1 dB | +0.0 dB | no |
| `score-silver-dust` | 0.0017 | -40.4 dB | -0.0 dB | no |
| `score-granular-hiss` | 0.0017 | -39.4 dB | +0.0 dB | yes |
| `score-ice-needle` | 0.0014 | -45.9 dB | +0.0 dB | yes |
| `score-stone-marimba` | 0.0014 | -45.2 dB | +0.0 dB | yes |
| `score-ghost-formants` | 0.0014 | -36.3 dB | +0.0 dB | no |
| `score-violet-section` | 0.0014 | -44.1 dB | -0.0 dB | no |
| `snare` | 0.0013 | -55.0 dB | +0.0 dB | yes |
| `score-wooden-pin` | 0.0013 | -45.9 dB | +0.0 dB | yes |
| `score-distant-gantry` | 0.0012 | -33.5 dB | -0.0 dB | no |
| `sub-drone` | 0.0012 | -47.7 dB | +0.0 dB | no |
| `score-tape-halo` | 0.0012 | -40.8 dB | +0.0 dB | no |
| `score-warm-pressure` | 0.0011 | -43.7 dB | +0.0 dB | yes |
| `score-afterimage-quartet` | 0.0011 | -47.5 dB | +0.1 dB | no |
| `score-black-resonator` | 0.0010 | -32.0 dB | -0.0 dB | no |
| `str-solina-ensemble` | 0.0010 | -43.5 dB | +0.0 dB | no |
| `score-felt-circuit` | 0.0009 | -48.5 dB | +0.0 dB | yes |
| `str-ob-strings` | 0.0009 | -46.8 dB | +0.0 dB | no |
| `pickup-blip` | 0.0008 | -58.8 dB | +0.0 dB | yes |
| `score-wire-harp` | 0.0008 | -50.2 dB | -0.0 dB | yes |
| `score-submerged-keys` | 0.0008 | -47.7 dB | -0.0 dB | yes |
| `score-quick-downwash` | 0.0007 | -45.4 dB | -0.0 dB | yes |
| `score-drowned-cellos` | 0.0007 | -46.7 dB | +0.0 dB | no |
| `str-supersaw-trance` | 0.0007 | -48.2 dB | +0.0 dB | no |
| `score-glass-horizon` | 0.0007 | -42.0 dB | +0.0 dB | no |
| `score-frozen-bow` | 0.0007 | -41.5 dB | +0.0 dB | no |
| `str-jp8-strings` | 0.0006 | -49.9 dB | +0.0 dB | no |
| `score-muted-chamber` | 0.0006 | -52.1 dB | +0.1 dB | no |
| `saw-arp` | 0.0005 | -57.0 dB | +0.0 dB | yes |
| `score-tidal-memory` | 0.0005 | -41.7 dB | +0.0 dB | no |
| `score-last-light-bell` | 0.0004 | -54.4 dB | -0.0 dB | yes |
| `score-quiet-reactor` | 0.0004 | -44.1 dB | +0.1 dB | no |
| `score-passing-vapour` | 0.0004 | -46.6 dB | +0.0 dB | no |
| `score-velvet-airlock` | 0.0004 | -43.5 dB | +0.0 dB | no |
| `score-black-ice-strings` | 0.0004 | -43.0 dB | +0.0 dB | no |
| `score-hollow-bows` | 0.0003 | -42.3 dB | +0.0 dB | no |
| `score-amber-ceiling` | 0.0003 | -49.6 dB | +0.0 dB | no |
| `score-bright-air-riser` | 0.0003 | -41.2 dB | +0.0 dB | no |
| `str-ambient-evolve` | 0.0003 | -49.2 dB | +0.0 dB | no |
| `score-silt-contrabass` | 0.0003 | -47.6 dB | +0.0 dB | no |
| `score-underwater-room` | 0.0003 | -45.7 dB | +0.0 dB | no |
| `score-dry-relay` | 0.0002 | -59.2 dB | +0.0 dB | yes |
| `score-polar-bloom` | 0.0002 | -43.4 dB | +0.0 dB | no |
| `score-buried-voices` | 0.0002 | -44.2 dB | +0.0 dB | no |
| `score-blue-vapour` | 0.0002 | -49.7 dB | +0.0 dB | no |
| `score-low-weather` | 0.0002 | -45.2 dB | +0.0 dB | no |
| `score-deep-static` | 0.0002 | -49.7 dB | +0.0 dB | no |
| `score-empty-station` | 0.0002 | -44.1 dB | +0.0 dB | no |
| `score-harbour-fog` | 0.0002 | -50.9 dB | +0.0 dB | no |
| `score-open-sea` | 0.0001 | -50.1 dB | +0.0 dB | no |
| `score-ash-cathedral` | 0.0001 | -40.8 dB | +0.0 dB | no |
| `score-deep-current` | 0.0001 | -50.4 dB | +0.0 dB | no |
| `score-pale-monolith` | 0.0001 | -47.4 dB | +0.0 dB | no |
| `score-long-downwash` | 0.0001 | -59.8 dB | -0.0 dB | yes |
| `score-vent-breath` | 0.0001 | -50.2 dB | +0.0 dB | no |
| `score-remote-orchestra` | 0.0001 | -50.7 dB | +0.0 dB | no |
| `score-long-dusk` | 0.0001 | -51.3 dB | +0.0 dB | no |
| `score-narrow-riser` | 0.0001 | -42.7 dB | +0.0 dB | no |
| `score-night-choir` | 0.0001 | -47.9 dB | +0.0 dB | no |
| `score-slow-air-riser` | 0.0000 | -48.4 dB | +0.0 dB | no |
| `kick` | 0.0000 | -183.1 dB | +0.0 dB | yes |

Bit-identical: `efm-bell-perc`, `efm-clap`, `efm-cowbell`, `efm-crash`, `efm-hat-closed`, `efm-hat-open`, `efm-kick`, `efm-rim`, `efm-snare`, `efm-tom`, `efm-zap`, `fm-hat-closed`, `fm-hat-open`, `hat`, `lead-width-sweep`, `score-broken-relay`, `score-buffer-drift`, `score-corrupt-clock`, `score-data-fragments`, `score-dry-ticker`, `score-engine-pulser`, `score-hollow-ticker`, `score-slow-beacon`, `tr808-clap`, `tr808-clave`, `tr808-conga`, `tr808-cowbell`, `tr808-cymbal`, `tr808-hat-closed`, `tr808-hat-open`, `tr808-kick`, `tr808-kick-long`, `tr808-kick-short`, `tr808-maracas`, `tr808-rimshot`, `tr808-snare`, `tr808-tom-high`, `tr808-tom-low`, `tr808-tom-mid`, `tr909-clap`, `tr909-crash`, `tr909-hat-closed`, `tr909-hat-open`, `tr909-kick`, `tr909-kick-hard`, `tr909-kick-long`, `tr909-kick-short`, `tr909-ride`, `tr909-rimshot`, `tr909-snare`, `tr909-tom-high`, `tr909-tom-low`, `tr909-tom-mid`
