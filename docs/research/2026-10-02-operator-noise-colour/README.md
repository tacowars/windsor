# A Noise operator's own colour: what it costs, and a snare to hear it on

windsor#362 gives a Noise operator its own two-pole Butterworth lowpass and
highpass, `noiseLp` and `noiseHp` (Hz; 0 or absent is off), on its noise
before its level and envelope, as windsor#361 recommended
(`../2026-10-01-tom-noise-colour-prototype/README.md`). The record is
`docs/log/2026-10-02-operator-noise-colour.md`. This folder holds the CPU
measurement the ticket asks for (invariant 5) and an audition song for
tacowars's listen. Nothing here is shipping code.

Measured on an Apple M1 (8 cores, macOS 26.5.1), Node 24.21.0, in the FM
worklet bundle under Node, not in a browser. The "before" bundle is
`origin/main` at `f1d0af0` (its FM bundle unchanged since `66685a1`, the
prototype's base). No other fit or test ran on the machine during the
benches; a browser and the desktop were open.

## Method

`bench.mjs` is the prototype's bench pointed at the engine: each variant
renders through its own root's `scripts/sound-match/render.mjs` and bundle,
one note, 10 s, 60 rounds after two warm-up rounds, the variants interleaved
and their order rotated each round. It reports the median ns per output
sample of the one voice, and the median of each round's difference from the
before bundle in the same round, with its interquartile range.

```bash
mkdir -p <before>/scripts/sound-match <before>/packages/engine/src/worklet/generated
git show origin/main:scripts/sound-match/render.mjs > <before>/scripts/sound-match/render.mjs
git show origin/main:packages/engine/src/worklet/generated/fm-processor.js \
  > <before>/packages/engine/src/worklet/generated/fm-processor.js
node bench.mjs <repo> <before> <prototype mirror>     # the prototype from ../2026-10-01-…/build.py --poles 2
node bench.mjs <repo> <before> --off 1 --rounds 80    # the off path alone
```

Two scenarios, the prototype's: `noise`, a lone Noise carrier held at full
level (the other operators silent, the voice filter off); `tom`,
`tr909-tom-mid` with every envelope held, so its four operators, its Noise
modulator (D) and its voice filter run throughout. Filters at 6 kHz
lowpass and 2 kHz highpass.

## Results

The full run, on the code as merged (`bench.mjs <repo> <before> <prototype>`):

| ns/sample | tom | against before | noise | against before |
|---|---|---|---|---|
| before | 29.06 | | 63.53 | |
| before, voice filter at 24 dB/oct (one more `Svf` section) | 31.90 | +2.82 [+2.38, +3.19] | | |
| engine, fields absent | 29.24 | +0.07 [−0.49, +0.62] | 64.91 | +1.11 [+0.40, +1.94] |
| engine, lowpass | 31.24 | +2.36 [+1.81, +2.79] | 67.31 | +3.92 [+2.92, +4.89] |
| engine, highpass | 31.64 | +2.55 [+1.95, +3.03] | 67.74 | +4.22 [+2.89, +5.46] |
| engine, both | 33.18 | **+4.20** [+3.58, +4.53] | 69.94 | **+6.51** [+5.55, +7.24] |
| prototype (windsor#361), fields absent | 31.24 | +2.10 [+1.71, +2.63] | 65.86 | +2.32 [+1.52, +2.82] |
| prototype, both | 38.39 | +9.34 [+8.98, +9.72] | 73.35 | +9.77 [+9.12, +10.19] |

The off path alone (`--off 1 --rounds 80`), three variants to a round, so
the rotation interferes less, and the before bundle twice for the run's own
noise floor:

| ns/sample | tom | against before | noise | against before |
|---|---|---|---|---|
| before | 28.84 | | 62.55 | |
| before, again | 28.82 | −0.04 [−0.19, +0.08] | 62.49 | −0.18 [−0.63, +0.31] |
| engine, fields absent | 28.82 | **+0.06** [−0.26, +0.29] | 62.73 | **+0.08** [−0.37, +0.85] |

- **Off, the cost is unchanged within measurement noise**: +0.06 and +0.08
  ns per sample, inside the before bundle's own spread against itself. The
  +1.11 on the lone carrier in the eight-variant run did not repeat with
  the rotation shortened; its interquartile range there is twice the tom's.
- **On, the pair costs 4.2 ns per sample on the held tom voice** (14 % of
  its 29 ns), about 2.4 ns for one section, against the prototype's 9.3 ns
  in the same run (7.6 in windsor#361's). One section costs about what the
  voice's own `Svf` section does (2.8 ns). On the lone Noise carrier the pair
  costs 6.5 ns of 63.5. A snare's noise sounds for 100–250 ms, and only a
  Noise operator with a field set pays.
- **Where the prototype's cost went.** It called a method per sample for
  every Noise operator, coloured or not (its off path, +2.1 ns), and read
  every coefficient from typed arrays. The engine hoists one flag per
  operator out of the loop and calls `NoiseColour.process`, whose
  coefficients and state are fields, only while a section is on.

### Tuned when the patch binds, not every block

windsor#362's decision 3 said the coefficients are set per control block.
The first build did that (`bindNoiseColour` was called from the control
update for each operator, comparing each field with the cutoff it was tuned
for), and the same bench read the off path at +0.62 [+0.27, +0.94] ns on the
tom and +0.97 [+0.60, +1.46] on the lone carrier: four calls a block, about
0.6 ns a sample. The fields can change only when the voice binds a patch (a
note-on, a live edit's `rebind`, a slide's `retarget`), and
`bindVoiceConstants` runs on each of those, so the tuning moved there. A
live edit is still heard from the next block
(`synth/fmProcessorNoiseColour.test.ts`), and no block does any colour work
while the fields are unchanged.

## The fitted snares render as the fits scored them

The fits in windsor#361 rendered through the prototype, which tuned with
`Math.tan` once per note. The engine tunes with the portable tangent
(`worklet/fm/portableTangent.ts`). Rendered through both (`render.mjs`,
0.5 s, noise seeds 1–4), the two snares below are the same bits in all
24 000 samples of every seed, where the same patches with the fields
stripped differ from them by up to 0.38 (the renders peak at 0.32–0.38). So the fits' scores in
windsor#361's README hold for the engine as merged.

## The audition (for tacowars's listen)

`audition/snare-audition.song.json` is a song to import on the Settings
tab of the PR's preview. It plays a backbeat at 100 BPM, two bars each, in
order:

1. `808 snare`: the shipped `tr808-snare`.
2. `808 snare, colour`: windsor#361's two-pole fit of it, optimizer seed 1
   (its noise through a highpass at 2370 Hz and a lowpass at 10089 Hz; the
   best band shape of that fit's two seeds, 2.68 and 1.72 dB).
3. `909 snare`: the shipped `tr909-snare`.
4. `909 snare, colour`: the two-pole fit, optimizer seed 2 (highpass
   1313 Hz, lowpass 11870 Hz; band shape 1.74 and 2.14 dB, objective 1.682).

The fits moved the snares' other parameters too (levels, envelopes, the
voice filter's corner), as their specs let them, so each pair is the
shipped patch against a refit that uses the fields, not the filters alone.
`audition/tr808-snare-colour.patch.json` and
`tr909-snare-colour.patch.json` are the two fitted patches as the song
carries them. Neither goes into `patches/`: refitting the library to the
fields is windsor#365's.

The song was built by the engine's own normaliser (`makeArrangement`, no
corrections) from the shipped patch files and the fits' `best.json` files
in windsor#361's scratch; the recordings the fits read are tacowars's
commercial pack and are not committed.
