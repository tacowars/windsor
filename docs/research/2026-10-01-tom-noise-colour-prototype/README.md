# Per-operator noise colour: a prototype, measured on the 909 tom and the TR snares

windsor#318, decision 3, built this prototype: a Noise operator's own
lowpass and highpass, so noise can be coloured without the voice filter.
Its first measurement, on the 909 mid tom, was invalid: the fits never
heard the prototype (below, "Why the first measurement was invalid").
windsor#361 fixed the build, re-measured the tom, added a two-pole variant
(with an optional resonance), and measured both filter orders on both
snares from windsor#353's specs. tacowars's listen notes on the shipped
snares (windsor#360) are weighed here too. This folder is research only:
nothing here is shipping code, and the shipped bundle, the worklet sources
and the patches are untouched.

Measured on an Apple M1 (8 cores, macOS 26.5.1), Node 24.21.0, Python
3.14.5, against `origin/main` at `f1d5562`. The FM bundle and the
sound-match toolkit are unchanged since `66685a1`, the first measurement's
base. The fits ran with two other workers' fits sharing the machine; the
CPU bench ran with no other fit running.

## The prototype

`build.py` copies `packages/engine/src/worklet/generated/fm-processor.js`
into a mirror of the sound-match toolkit and patches the copy. It copies
the toolkit and the patches as well, so the toolkit's own `fit.py`,
`compare.py` and `render.mjs` run against the copy unchanged:

```bash
python build.py <out>/nc1p --poles 1      # any folder outside the repository
python build.py <out>/nc2p --poles 2
python build.py --check <out>/nc1p        # self-check an existing mirror
cd <out>/nc1p/scripts/sound-match
python fit.py <repo>/docs/research/2026-10-01-tr-percussion-fit/specs/tr909-tom-mid.pass2d-noise.json
```

A Noise operator takes two new fields, `noiseLp` and `noiseHp` (Hz; 0 or
absent is off), a lowpass and a highpass on that operator's own noise,
before its level and envelope:

- `--poles 1`: one-pole filters, 6 dB/oct (topology-preserving,
  tan-prewarped), windsor#318's prototype.
- `--poles 2`: two-pole state-variable filters, 12 dB/oct, the same TPT form
  as the voice's `Svf`. Two more fields, `noiseLpQ` and `noiseHpQ`, set each
  filter's resonance (Q, at least 0.5); 0 or absent is Butterworth (Q 0.707).

A patch without the fields renders bit for bit as the shipped bundle does.
The coefficients are set once per note, with `Math.tan`. There is no
smoothing and no portability work: it is a prototype for measuring, not
the engine change.

**The self-check** runs after every build, and on its own with `--check`.
It fails unless all three hold:

- no toolkit entry in the mirror is a symlink;
- `tr909-tom-mid` without the fields renders, through the mirror's
  `render.mjs`, bit for bit as through the repository's (seed 3);
- through the mirror's own `compare.py`, run as the fits run it, the same
  patch with `noiseLp` at 2 kHz on its Noise operator scores differently
  from the patch without it, against a render of the patch without it.

On the fixed mirrors it passes (one-pole: 0.3592 against 0.0000; two-pole:
0.3577 against 0.0000). On a mirror with the toolkit's `.py` files and
`specs` turned back into symlinks, windsor#318's layout, it fails on both
counts: the symlinks, and "scores exactly as without it (0.000000) through
the mirror's compare.py: the fields are ignored".

## Why the first measurement was invalid

windsor#318's `build.py` copied `render.mjs` into the mirror but symlinked
the toolkit's `.py` files. Python puts a script's real directory first on
`sys.path`, so `fit.py`, run from the mirror, imported the repository's
`renderer.py`. That found the repository's `render.mjs` and the shipped
bundle, and `noiseLp` and `noiseHp` were silently ignored. Structure d was
structure e measured again with two dead parameters: 0.8989 against
0.8986. windsor#353 found it while reusing the prototype on the snares
(`docs/research/2026-10-01-tr-snare-fit/README.md`). `build.py` now copies
everything and checks that the fields are heard.

## The 909 mid tom, re-measured

windsor#318's experiment, rerun as it was: the tones stay the shipped first
pass's, and only the noise and what colours it move. Each fit is CMA-ES
(σ 0.15, 800 evaluations, optimizer seed 1, noise seeds 1–4, `pitch` and
`harm` weights 0), from the specs in
`../2026-10-01-tr-percussion-fit/specs/`. Structure d runs on each
mirror with the same spec, so its filters are one-pole on one and
two-pole (Butterworth) on the other. The readings are `tom909.py`'s (the
toolkit's region band level, 2–6 kHz, candidate minus recording, mean of
noise seeds 1–4) and the fit's objective.

| Structure | objective | 2–6 kHz, 0–5 ms | 2–6 kHz, 30–150 ms | The fit's noise filters |
|---|---|---|---|---|
| shipped (`tr909-tom-mid`, the second pass: b, then its tones refitted) | 0.8941 | −0.3 dB | −1.1 dB | |
| e, shared filter and drive tone | 0.8986 | +2.5 dB | +3.5 dB | |
| d, one-pole | 0.9041 | +1.0 dB | +4.1 dB | lowpass 18.4 kHz, highpass 22 Hz |
| d, two-pole | 0.9019 | +1.8 dB | +2.9 dB | lowpass 20.0 kHz, highpass 22 Hz |
| b, FM-coloured noise | **0.8713** | **+0.3 dB** | **−0.3 dB** | |

b and e reproduce windsor#318's numbers to the fourth decimal, so the base
did not move. Both d fits open their filters to near the ends of their
ranges (the highpass's floor is 20 Hz, the lowpass's ceiling 20 kHz): the tom
does not want its noise filtered on its own. With the filters taken out of
the fitted patches, d scores 0.9015 (one-pole) and 0.8991 (two-pole), a
little better than with them. d ends worse than e: it searched two more
dimensions on the same budget, from a start whose open filters still cost
0.0015 (0.9245 against 0.9230). **On the tom, per-operator noise
colour gains nothing, and FM-coloured noise (structure b) still wins**,
by 0.03 on the objective and by 0.7–3.8 dB on the 2–6 kHz readings.

## The snares

windsor#353's noise-colour specs
(`../2026-10-01-tr-snare-fit/specs/tr*-snare.noise-colour.json`: the shipped
white-noise structure plus the two fields, the transient's 10 ms head as a
second reference at half weight, `wave` at 4, 2000 evaluations), run on
each mirror. Each spec ran with optimizer seeds 1 and 2 (a copy of the spec
with `optimizer.seed` 2), since one CMA-ES run's luck is the size of the
differences being read. The resonant variant has its own specs here
(`specs/tr*-snare.noise-colour-q.json`): the same, plus `noiseHpQ` and
`noiseLpQ` over 0.5–8 (log), starting at Butterworth, optimizer seed 1. The
shipped rows are `main`'s white-noise patches (windsor#360).

### Scores

The fit's objective, and the toolkit's default-weight total (`stft` 1,
`band` 0.1, `wave` 2) on the whole hit and on its first 10 ms, as
windsor#353 reported them. Lower is closer; two numbers are optimizer seeds
1 and 2.

| | objective | default total | first 10 ms | The fit's noise filters (highpass, lowpass) |
|---|---|---|---|---|
| 808 shipped (white) | 1.891 | 1.621 | 2.276 | |
| 808 one-pole | **1.448, 1.435** | 1.241, **1.224** | 1.708, 1.696 | 2550 / 6572 Hz; 3498 / 5087 Hz |
| 808 two-pole | 1.453, 1.489 | 1.252, 1.270 | **1.681**, 1.765 | 2370 / 10089 Hz; 1716 / 10364 Hz |
| 808 two-pole with Q | 1.468 | 1.247 | 1.743 | 2281 Hz Q 1.19 / 13496 Hz Q 0.50 |
| 909 shipped (white) | 2.000 | 1.623 | 2.229 | |
| 909 one-pole | 1.701, 1.713 | 1.384, 1.374 | 1.741, 1.828 | 374 / 8956 Hz; 1098 / 7653 Hz |
| 909 two-pole | **1.680, 1.682** | 1.397, **1.368** | **1.725**, 1.767 | 887 / 12535 Hz; 1314 / 11870 Hz |
| 909 two-pole with Q | 1.760 | 1.451 | 1.786 | 534 Hz Q 0.93 / 13322 Hz Q 0.61 |

The one-pole seed-1 rows reproduce windsor#353's (808 objective 1.4484,
default total 1.241; 909 default total 1.383). Both orders take about a
quarter off the shipped scores, and on the scores they tie: the 808 leans
one-pole by 0.03 on the objective, the 909 two-pole by 0.03, and one
order's two optimizer seeds differ by up to 0.04.

### The noise's spectrum

What the scores read coarsely (the toolkit's band score has five bands) is
what tacowars's notes on the shipped snares are about: the 808's noise
"missing some brightness and sizzle", and the 909's "dull", "plain white
noise instead of the more convincing snare wire sound". `snarenoise.py`
reads it directly, mean of noise seeds 1–4.

**Band shape**, windsor#353's measure: over 1–15 kHz in third-octaves,
each side's mean removed, the RMS of candidate minus recording, over 5–30
and 30–80 ms.

| Band shape error | 808, 5–30 ms | 808, 30–80 ms | 909, 5–30 ms | 909, 30–80 ms |
|---|---|---|---|---|
| shipped (white) | 5.56 dB | 5.03 dB | 3.16 dB | 3.78 dB |
| one-pole, seeds 1, 2 | 3.70, 3.49 | 3.36, 3.17 | 2.74, 2.41 | 3.65, 3.19 |
| two-pole, seeds 1, 2 | **2.68**, 3.13 | **1.72**, 2.78 | 2.21, **1.74** | 2.94, **2.14** |
| two-pole with Q | 2.41 | 2.07 | 2.66 | 3.55 |

The two-pole is closer in every pairing of the same optimizer seed, by
0.4–1.6 dB. Part of it is the one-pole's 6 dB/oct skirt: the 808 one-pole
fits keep 5.4–6.8 dB too much at 1.1–1.4 kHz, the two-pole fits 0.3–2.9 dB
(seed 1) and 4.1–5.6 dB (seed 2).

**Level by band**, dB re each side's peak, candidate minus recording:

| | 2–6 kHz, 5–30 ms | 6–10 kHz, 5–30 ms | above 10 kHz, 5–30 ms | 2–6 kHz, 30–80 ms | 6–10 kHz, 30–80 ms | above 10 kHz, 30–80 ms | slope 2–16 kHz, 5–80 ms |
|---|---|---|---|---|---|---|---|
| 808 recording | −19.9 | −23.7 | −27.8 | −39.8 | −42.0 | −44.7 | −3.7 dB/oct |
| 808 shipped | −9.1 | −5.0 | +4.5 | −7.4 | −5.0 | +2.8 | +0.4 dB/oct |
| 808 one-pole, seeds 1, 2 | −3.8, −5.0 | −1.0, −2.1 | +1.4, 0.0 | −3.4, −2.1 | −2.4, −1.3 | −1.4, −0.7 | −1.7, −1.8 |
| 808 two-pole, seeds 1, 2 | −4.3, −3.4 | −0.3, +0.1 | +0.1, +0.8 | −0.5, −2.0 | +1.5, −0.3 | +0.3, −1.2 | −1.5, −2.0 |
| 909 recording | −22.3 | −19.9 | −24.8 | −26.5 | −25.3 | −30.1 | −1.6 dB/oct |
| 909 shipped | −6.1 | −8.1 | +2.2 | −5.0 | −5.9 | +4.2 | +0.3 dB/oct |
| 909 one-pole, seeds 1, 2 | −2.9, −2.2 | −6.4, −5.9 | −2.5, −2.5 | −2.4, −1.3 | −5.1, −4.2 | −1.1, −0.7 | −2.0, −2.2 |
| 909 two-pole, seeds 1, 2 | −2.3, −0.3 | −4.7, −2.7 | −1.0, +0.3 | −2.9, −1.2 | −4.2, −2.6 | −0.4, +0.3 | −1.1, −1.4 |

The notes read in these numbers. The shipped white noise has too much
above 10 kHz (+2 to +5 dB) and too little where each recording's snappy
lives: the 808's 2–6 kHz band (−7 to −9 dB) and the 909's 6–10 kHz
presence (−6 to −8 dB; the 909 recording is loudest in 6–10 kHz). Its
spectrum is flat (+0.3 to +0.4 dB/oct) where the recordings fall (−1.6 and
−3.7 dB/oct): white noise, as heard. Either filter order brings the
808's 2–6 kHz band within 5 dB and everything above 6 kHz within 2.5 dB.
The 909's 6–10 kHz presence stays short in every fit, 2.6–6.4 dB, least in
the two-pole's (2.6–4.7 dB against 4.2–6.4 dB), with the lowpass at
7.7–13.3 kHz and the rest of the snappy 0–3 dB under the recording's. That
gap is the refit's (windsor#365) to weigh, not the filter's: the
shape-only fit below puts a two-pole pair within 1.4 dB of the 909's band.
The 909's missing ring and the 808's flat attack are not noise colour and
are not read here.

### What the shape alone allows

`shapefit.py` fits each filter family's response straight to a
recording's band shape (no rendering: a Noise operator's spectrum is its
filter's |H|², exactly the TPT forms' responses, averaged over each third
of an octave as the Welch bins are), one static filter for both spans.
The error is a floor for the shape: a fitted patch also carries the tones,
the envelopes and one noise draw.

| Band shape floor, 5–30 and 30–80 ms together | 808 | 909 |
|---|---|---|
| white (no filter) | 5.06 dB | 3.30 dB |
| one-pole lowpass and highpass | 2.76 dB (both at 5.0 kHz) | 1.59 dB (both at 4.8 kHz) |
| two-pole lowpass and highpass | **1.41 dB** (highpass 2.7, lowpass 8.1 kHz) | **1.37 dB** (highpass 1.8, lowpass 10.6 kHz) |
| two-pole, each with its Q | 1.15 dB (highpass 3.0 kHz Q 0.84, lowpass 9.1 kHz Q 0.50) | 1.07 dB (highpass 1.4 kHz Q 0.56, lowpass 9.5 kHz Q 1.03) |
| two-pole bandpass with Q | 1.52 dB (4.7 kHz, Q 1.17) | 1.56 dB (4.8 kHz, Q 0.56) |

The one-pole can only make a broad hump: its best on both recordings puts
both cutoffs at one frequency. The two-pole halves the 808's floor. Its
best cutoffs are near the two-pole snare fits' (808: highpass 1.7–2.4 kHz,
lowpass 10.1–10.4 kHz; 909: highpass 0.9–1.3 kHz, lowpass 11.9–12.5 kHz),
the fits' highpasses lower.

### Resonance

Asked: does a resonant shape (a Q field on the pair, or a two-pole
bandpass) get the snare wires' "peaks and slope" where gentle slopes do
not? Measured, no:

- The recordings have no resonant peak to match. windsor#353 found their
  strongest narrow peaks above 1 kHz +10 to +13 dB over their neighbours,
  the same as white noise's random ones; their shape is a band with a slope.
- On the shape alone, a Q on each filter improves the two-pole's floor by
  0.26 dB (808) and 0.30 dB (909). Two of the fitted Qs are under
  Butterworth (0.50, 0.56: a softer knee, no peak) and two a little over
  (0.84, a 0.4 dB bump; 1.03, 1.4 dB). The bandpass is worse than the
  plain pair on both.
- In the full fits, with two more dimensions on the same budget, the
  resonant variant scored worse than the plain two-pole on both snares
  (808 1.468 against 1.453; 909 1.760 against 1.680), and its Qs stayed
  mild (808 highpass 1.19, a 2.4 dB bump, lowpass 0.50; 909 0.93, a 0.9 dB
  bump, and 0.61).

So a Q field does not earn its place. The slope is what the snappy needs,
and the two-pole gives it.

## Cost per sample

`bench.mjs` renders through each bundle's own `render.mjs`: one note, 10 s,
40 interleaved rounds after two warm-up rounds, median ns per output sample
of the one voice, and the median per-round difference from the shipped
bundle with its interquartile range. `tom` is `tr909-tom-mid` with every
envelope held, so its four operators, its Noise modulator (D) and its
voice filter (one two-pole `Svf` section) run throughout; `noise` is a lone
Noise carrier held at full level, the voice filter off. Filters at 6 kHz
lowpass, 2 kHz highpass; the two-pole mirror is `build.py --poles 2` (the
resonance fields absent).

| tom, ns/sample | median | against shipped |
|---|---|---|
| shipped | 28.99 | |
| shipped, voice filter off | 26.17 | −2.71 [−3.17, −2.59] |
| shipped, voice filter at 24 dB/oct (two sections) | 31.66 | +2.77 [+2.32, +2.94] |
| one-pole mirror, fields absent | 30.62 | +1.71 [+1.31, +1.85] |
| one-pole lowpass | 31.40 | +2.49 [+2.00, +2.73] |
| one-pole highpass | 31.45 | +2.45 [+2.02, +2.72] |
| one-pole lowpass and highpass | 32.43 | +3.44 [+2.81, +3.74] |
| two-pole mirror, fields absent | 30.58 | +1.62 [+1.28, +1.97] |
| two-pole lowpass | 33.95 | +4.93 [+4.65, +5.26] |
| two-pole highpass | 34.47 | +5.56 [+5.14, +5.79] |
| two-pole lowpass and highpass | 38.28 | +9.25 [+8.66, +9.54] |

On the lone Noise carrier (62.69 ns/sample shipped) the same differences
read: one-pole pair +3.87 [+2.99, +4.16], two-pole pair +10.25 [+9.58,
+10.82], fields absent +2.46 and +2.32.

So, over the prototype's own off path (+1.6 to +1.7 ns, the per-sample
call and checks that an engine version would hoist to the control block):
the one-pole pair costs 1.7 ns per sample (1.4 on the lone carrier), the
two-pole pair 7.6 ns (7.9), about 0.8 and 3.3–3.9 ns per filter. The
voice's own `Svf` section measures 2.7 ns in the same run. The prototype's
two-pole reads its coefficients and state from typed arrays every sample,
where an engine version would hold them in locals across the block;
whether that lands it nearer the `Svf`'s cost is the engine ticket's to
measure.
On the held four-operator tom (29 ns), the prototype's pair is 6 % one-pole
and 26 % two-pole; a snare's noise sounds for 100–250 ms.

An aside, measured and not investigated: the lone Noise carrier costs
62.7 ns/sample on the shipped bundle, against 29.0 for the whole held tom
voice, whose Noise operator is a modulator and whose carrier C is a sine.
A scratch probe by the same method measured the held tom at 68 ns/sample
with C switched to Noise. A Noise operator in a carrier's slot looks
expensive in itself; that is worth a look of its own.

## The finding

- **The 909 tom:** per-operator noise colour gains nothing. The fits open
  both filters, and FM-coloured noise (structure b, shipped) stays the best
  by 0.03 on the objective and 0.7–3.8 dB on the 2–6 kHz readings.
- **The snares:** it is the change they ask for. Either filter order takes
  about a quarter off the shipped scores (808 objective 1.891 to 1.43–1.49;
  909 2.000 to 1.68–1.71), and the two orders tie on the scores. On the
  noise's spectrum, which is what tacowars's notes describe, the two-pole
  is closer in every fit (band shape 0.4–1.6 dB closer) and halves the
  808's attainable floor (2.76 to 1.41 dB).
- **Order, by score per CPU:** per point of objective, the one-pole is the
  better buy (the same gain for 1.7 ns against 7.6 ns per sample in the
  prototype). Per dB of band shape, the measure the listen notes point at,
  only the two-pole delivers. **Recommendation: two-pole, Butterworth.**
  The extra cost is a few ns per sample per filtered Noise operator, paid
  only while one sounds and only when its fields are set.
- **Resonance:** no Q field. The recordings have no peaks to match, the
  fitted Qs stay near Butterworth (0.5–1.2), the shape floor improves by
  0.3 dB at most, and the full fits with a Q score worse.

## The proposed engine ticket (windsor#362)

> **Per-operator noise colour.** A Noise operator gains `noiseLp` and
> `noiseHp` (Hz; 0 or absent is off): a two-pole (12 dB/oct) state-variable
> lowpass and highpass, Butterworth (Q 0.707, no resonance field), on that
> operator's own noise, before its level and envelope. Both 20 Hz–20 kHz on
> a log scale, 0 off; the snare fits put the highpass at 0.37–3.5 kHz and
> the lowpass at 5.1–13.5 kHz, and the tom fits opened both. The
> coefficients are set per control block from the fields (portable
> arithmetic for the prewarp's tan, as `voiceDrive.ts` does for its tone's
> cutoff), the state lives in the voice's preallocated arrays and is held
> in locals across the block, both render loops carry it inline and stay
> bit-identical to each other, and an operator with neither field set
> takes no per-sample work. Additive fields whose default (0) reproduces
> today's noise bit for bit, so no format bump, and the golden is
> unchanged. Measure its cost against this prototype's (7.6 ns per sample
> for the pair on the held tom voice, the voice's own `Svf` section 2.7 ns;
> `docs/research/2026-10-01-tom-noise-colour-prototype/`). The snares'
> refit (windsor#365) is the sound that uses it; the 909 tom keeps its
> FM-coloured noise.

The other change windsor#318's decision 3 named, a per-operator
pitch-envelope depth, was not prototyped: the noise did not need it, and
the 909 tom's glide is a shared one in the recording, which the global
pitch envelope already models (`../2026-10-01-tr-percussion-fit/README.md`,
"The 909 tom's glide").

## The first measurement (invalid)

Kept as it was published in windsor#318, with its reason. **Invalid:**
`build.py` symlinked the toolkit's `.py` files into the mirror, so the fits
imported the repository's `renderer.py` and rendered through the shipped
bundle; `noiseLp` and `noiseHp` were ignored, and row d is row e measured
again with two dead parameters (above, "Why the first measurement was
invalid"). Its conclusion, that the prototype "gained nothing", was not
shown by it. The re-measurement above reaches the same conclusion for the
tom, and the opposite for the snares.

| Structure | objective | 2–6 kHz, 0–5 ms | 2–6 kHz, 30–150 ms |
|---|---|---|---|
| shipped (then: the first pass) | 0.9230 | −2.3 dB | +5.6 dB |
| e, shared filter and drive tone | 0.8986 | +2.5 dB | +3.5 dB |
| d, the prototype (**invalid**: the fields were not rendered) | 0.8989 | +2.5 dB | +2.1 dB |
| b, FM-coloured noise | **0.8713** | **+0.3 dB** | **−0.3 dB** |

It read the 909 tom against `origin/main` at `66685a1` on the same machine
(Python 3.14.5), with the same specs, seeds and budget as the re-run.

## Reproducing

The toolkit's venv (`scripts/sound-match/README.md`), outside the
repository, and the recordings from tacowars's folder (a commercial pack:
nothing derived from them is committed):

```bash
export SM_TR_REFS=<…>/windsor-tr-refs
export SM_SNARE_HEADS=<scratch>          # the 10 ms heads, cut as in ../2026-10-01-tr-snare-fit/README.md
python build.py <out>/nc1p --poles 1
python build.py <out>/nc2p --poles 2
cd <out>/nc1p/scripts/sound-match         # or nc2p
python fit.py <repo>/docs/research/2026-10-01-tr-percussion-fit/specs/tr909-tom-mid.pass2d-noise.json
python <repo>/docs/research/2026-10-01-tr-percussion-fit/tom909.py "$SM_TR_REFS/Tom Mid 909 Clean 03.wav" <best.json>
python fit.py <repo>/docs/research/2026-10-01-tr-snare-fit/specs/tr808-snare.noise-colour.json
python fit.py <repo>/docs/research/2026-10-01-tom-noise-colour-prototype/specs/tr808-snare.noise-colour-q.json   # nc2p
python <repo>/docs/research/2026-10-01-tom-noise-colour-prototype/snarenoise.py "$SM_TR_REFS/SD A 808 Tone C 06.wav" <patches…>
python <repo>/docs/research/2026-10-01-tom-noise-colour-prototype/shapefit.py "$SM_TR_REFS/SD A 808 Tone C 06.wav" "$SM_TR_REFS/SD 909 Clean D 06.wav"
node <repo>/docs/research/2026-10-01-tom-noise-colour-prototype/bench.mjs <repo> <out>/nc1p <out>/nc2p
```

b and e run on either mirror (without the fields it renders as shipped).
The plain two-pole fits ran on a two-pole build from before the resonance
fields were added; their best patches, and the two-pole tom's, render bit
for bit the same on the final build (noise seeds 1–4), and the final
builds' bundles are byte for byte the ones the other fits and the bench
used.
The seed-2 runs are the same specs with `optimizer.seed` set to 2. CMA-ES
with a fixed seed makes each run repeatable on the same machine. A
patch's fit objective under a spec is `fit.Objective(spec, renderer,
log).score_patch(patch)`, which the shipped and filter-stripped rows used.
