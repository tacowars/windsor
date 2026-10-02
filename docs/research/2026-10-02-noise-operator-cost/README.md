# Why a Noise carrier cost twice a whole drum voice

windsor#382 follows up an aside in windsor#380
(`docs/research/2026-10-01-tom-noise-colour-prototype/README.md`, "An
aside"): a lone Noise carrier measured 62.7 ns/sample on the shipped
bundle, the whole held four-operator 909 tom 29.0, and the same tom with
its carrier C switched to Noise 68.

**The cause is not the Noise operator.** Both slow scenarios had two Noise
operators on an algorithm whose evaluation order is not D..A, and such a
voice was refused the fixed-index kernel and rendered on the generic loop,
which costs about 2.5–2.9× the kernel for the same voice:

- windsor#380's "lone" Noise carrier is `tr909-tom-mid` moved to Additive
  (A|B|C|D) with C a Noise operator at level 1 and the others at level 0.
  D keeps the tom's Noise wave at level 0, and a Noise operator is never
  skipped, since its draws advance the voice's shared noise generator. Two
  Noise operators on Additive: generic loop.
- The tom with C switched to Noise has C and D both Noise on Stack + Two
  (D>C | B | A). Generic loop.
- A real lone Noise carrier (D a sine) takes the kernel and costs about
  2 ns/sample more than a lone sine carrier. The Noise draw is inlined (it
  never shows in the profile) and is an xorshift and a divide.

The PRNG, a per-sample branch and denormals are not it: the profile puts
74–79 % of the time in `renderVoiceGeneric` for both slow scenarios, and
forcing the generic loop (`specialise: false`) on the fast ones reproduces
the slow numbers.

**The fix (local, in this PR):** the kernel's rule for two Noise operators
was stricter than its reason. The draws are the only state operators
share, so the kernel renders the same bits whenever the Noise operators
come in descending index order within the generic loop's evaluation order,
whatever the other operators do. Before, a second Noise operator needed the
whole order to be D..A. `voiceControl.ts`'s `noiseDrawsDescend` now checks
the Noise operators alone at bind time. That puts the tom with C switched
to Noise back on the kernel: **69.0 to 31.5 ns/sample**. The PRNG, its
seeding and both render loops are untouched; the FM golden does not move;
the kernel test now renders the newly admitted voices against the generic
loop to the bit.

**What is still slow, and the proposal:** any two Noise operators on
Additive, the natural snare and hat algorithm, still take the generic
loop (65–66 ns/sample for a snare shape with two Noise carriers), because
the generic loop draws A..D there and the kernel D..A. Making them cheap
needs a new kernel path, which windsor#382's decisions keep for a proposal
("The proposal", below). No shipped patch has two Noise operators, so no
shipped sound changes speed either way.

Measured on an Apple M1 (8 cores, macOS 26.5.1), Node 24.21.0, against
`origin/main` at `b7c7bb6` (windsor#381 merged). Other workers' test runs
shared the machine: the load average read 4–6 through every run, recorded
in each raw file. Every comparison below is interleaved within one process
and round, so the load moves both sides of it.

## Method

`bench.mjs` is windsor#380's method with the bundles named on the command
line: each bundle is evaluated once as `scripts/sound-match/render.mjs`
evaluates it (a stand-in `AudioWorkletProcessor`, 128-frame blocks at
48 kHz, seed 1), one note-on at frame 0 and no note-off, every envelope
held at its peak so no operator sleeps and the voice never goes dormant.
The time is wall time around one note's render, in ns per output sample of
the one voice; 40 rounds of 10 s per variant after two warm-up rounds, the
variants interleaved with their order rotated each round; the median and
its interquartile range. Each scenario runs in its own process
(`--only`), so the scenarios do not share V8's type feedback, and each
also runs with `specialise: false`, every voice on the generic loop. The
`kernel` column is whether the sounding voice took the kernel. `base` is
`origin/main`'s bundle, `after` this branch's.

| scenario | what it is |
|---|---|
| `noise380` | windsor#380's lone Noise carrier, exactly (Additive; C Noise at level 1; D Noise at level 0; A and B sines at level 0; voice filter off) |
| `noise1` | the same with D a sine: C is the only Noise operator |
| `sine1` | the same with C a sine too: a lone sine carrier |
| `tom` | `tr909-tom-mid` held: Stack + Two, Noise modulator D into sine carrier C |
| `tomC` | the same with C switched to Noise (C and D Noise) |
| `snare7` | Additive, two sines and two Noise carriers (C, D) at level 0.5, a snare's shape |

## Results

ns/sample, median [IQR] (`results/bench.txt`):

| scenario | kernel, base | base | after | kernel, after | generic loop |
|---|---|---|---|---|---|
| `noise380` | no | 63.35 [60.88, 65.03] | 63.38 [60.82, 66.22] | no | 63.89 [61.93, 67.37] |
| `noise1` | yes | 26.89 [25.48, 27.86] | 26.49 [25.52, 27.48] | yes | 67.80 [64.84, 71.30] |
| `sine1` | yes | 24.07 [23.65, 25.64] | 24.03 [23.64, 25.48] | yes | 69.13 [67.36, 71.63] |
| `tom` | yes | 27.67 [26.91, 28.91] | 27.65 [27.10, 29.13] | yes | 78.84 [77.23, 81.55] |
| `tomC` | no | **69.00** [66.47, 70.60] | **31.50** [30.17, 32.43] | yes | 70.60 [67.81, 72.29] |
| `snare7` | no | 66.40 [63.22, 68.59] | 65.67 [63.64, 68.42] | no | 65.46 [63.46, 67.50] |

The generic loop column is `base` with `specialise: false`; `after`'s
generic rows read the same within their spread (`results/bench.txt`).

- **The lone Noise carrier, before and after:** 63.4 in both, as windsor#380
  measured it (62.7), since its two Noise operators on Additive still take
  the generic loop. Without the silent second Noise operator it is 26.9
  (26.5 after), against 24.1 for a lone sine carrier.
- **A drum voice, before and after:** the held tom 27.7 in both (its path
  is unchanged); the tom with a Noise carrier 69.0 before, 31.5 after, so
  the Noise carrier now costs it 3.9 ns over the sine carrier it replaced.
- **Noise against sine on the kernel:** five alternating repeats of
  `noise1` and `sine1`, each its own process (`results/bench-repeats.txt`,
  read under heavier load), put the Noise carrier 0.9–2.4 ns above the
  sine in the four clean pairs (the fifth sine run caught a load spike);
  this run, 2.8. No change is proposed for that.
- **windsor#380's own bench**, rerun with this branch's bundle as both of
  its mirrors (`results/bench-380-method.txt`): its "off" rows, the after
  bundle against the shipped one in the same round, read +0.90 and −0.70
  on its lone carrier and +0.56 and +0.39 on the tom, within their spread:
  neither of its scenarios changes path.

## The profile

`node --cpu-prof` around `bench.mjs --only <scenario> --generic 0`, self
time by function (`selftime.mjs`, `results/profile.txt`):

| scenario | top self time |
|---|---|
| `noise380`, base and after | `renderVoiceGeneric` 74–79 %, `updateVoiceControl` 4–7 % |
| `noise1`, base and after | `renderVoiceKernel` 44–48 %, `updateVoiceControl` 16–19 %, `updateOperatorAmp` 5–6 % |
| `tomC`, base | `renderVoiceGeneric` 74 % |
| `tomC`, after | `renderVoiceKernel` 56 % |

`noise()` never appears: V8 inlines it into both loops. `buildMips` (4–8 %)
is the bench building a processor per round, not the render.

## What the new rule admits

A voice's Noise operators, two or more, per algorithm: the sets the kernel
takes before (the whole order D..A) and after (the Noise draws D..A), of
the 11 sets of two or more operators each algorithm has:

| algorithm | order | before | after | still on the generic loop |
|---|---|---|---|---|
| 0 Series | DCBA | 11 | 11 | |
| 1 Twin Mod | CDBA | 0 | 7 | CD, ACD, BCD, ABCD |
| 2 Stack + Mod | CBDA | 0 | 5 | BD, ABD, CD, ACD, BCD, ABCD |
| 3 Pair into A | DCBA | 11 | 11 | |
| 4 Two Stacks | BADC | 0 | 2 | AC, BC, ABC, AD, BD, ABD, ACD, BCD, ABCD |
| 5 One to Three | DABC | 0 | 3 | AB, AC, BC, ABC, ABD, ACD, BCD, ABCD |
| 6 Stack + Two | ABDC | 0 | 1 | AB, AC, BC, ABC, AD, BD, ABD, ACD, BCD, ABCD |
| 7 Additive | ABCD | 0 | 0 | every set |
| 8 Series + Tap | DCBA | 11 | 11 | |
| 9 Split Branch | DCAB | 0 | 7 | AB, ABC, ABD, ABCD |
| 10 Triple Mod | BCDA | 0 | 3 | BC, ABC, BD, ABD, CD, ACD, BCD, ABCD |
| total | | 33 of 121 | 61 of 121 | 60 |

## The proposal

For the 60 sets still refused, Additive's among them, two ways, both
needing tacowars's decision:

1. **Draw ahead in the kernel (bit-identical; a new kernel path).** When
   `noiseDrawsDescend` fails, the kernel draws each sample's Noise values
   at the top of the sample, in the generic loop's order, into a
   preallocated `Float64Array` on the voice (a double store and load are
   exact), and each Noise operator's section reads its slot instead of
   calling `noise()`, behind a flag hoisted per call. Every voice then takes
   the kernel; the PRNG, its seeding and the generic loop are untouched,
   and `fmProcessorKernel.test.ts` proves the bits. The draw order per
   voice is a few bytes set at bind time. Its cost on the kernel, and on
   the one-Noise path it must leave as it is, are for that change to
   measure; `tomC` here shows the size of the prize (69 to 31.5).
2. **Define the draw order as D..A in both loops (changes bits).** The
   generic loop draws its Noise values D..A at the top of each sample, and
   the kernel's rule goes. Same generator, same seed, same sequence, but on
   the algorithms above two Noise operators swap which draws they take, so
   a user's multi-Noise patch renders different (statistically identical)
   noise. No shipped patch has two Noise operators, so the golden would not
   move; it breaks "output stays bit-identical" for user patches, which is
   why it is not built here.

Option 1 is the recommendation. Until then, the windsor-engine skill
(`references/synth-behavior.md`) tells sound design to keep a drum patch
to one Noise operator or to pick an algorithm that draws them D..A.

## Reproduce

```bash
cp packages/engine/src/worklet/generated/fm-processor.js <out>/base.js   # on origin/main
node scripts/build-worklets.mjs                                           # on this branch
for s in noise380 noise1 sine1 tom tomC snare7; do
  node docs/research/2026-10-02-noise-operator-cost/bench.mjs . \
    base=<out>/base.js after=packages/engine/src/worklet/generated/fm-processor.js \
    --rounds 40 --seconds 10 --only $s
done
node --cpu-prof --cpu-prof-dir=<out>/prof docs/research/2026-10-02-noise-operator-cost/bench.mjs . \
  base=<out>/base.js --rounds 10 --only noise380 --generic 0
node docs/research/2026-10-02-noise-operator-cost/selftime.mjs <out>/prof/*.cpuprofile
```

windsor#380's bench takes three roots, each a mirror holding
`scripts/sound-match/render.mjs`,
`packages/engine/src/worklet/generated/fm-processor.js` and
`packages/engine/src/patches/tr909-tom-mid.json`; it ran with the base
mirror first and the after mirror as both others.
