# An operator's own filters on every wave: what they cost

windsor#590 gives every operator wave its own two-pole lowpass and
highpass, `opLp` and `opHp`, with `opTrack` key tracking; windsor#362 had
given them to a Noise operator alone. The record is
`docs/log/2026-10-04-operator-filters-on-every-wave.md`. This folder holds
the CPU measurement behind that record's cost figures (invariant 5).
Nothing here is shipping code.

Measured on an Apple M1 (8 cores, macOS 26.7.1), Node 24.21.0, in the FM
worklet bundle under Node through `scripts/sound-match/render.mjs`, not in
a browser, against `origin/main`'s bundle from before this change.

## Method

The method of `../2026-10-02-operator-noise-colour/bench.mjs`: one held
note at C3, `tr909-tom-mid`'s envelopes held at their peak, variants
interleaved with their order rotated each round, two warm-up rounds, then
400 rounds of 10 s; the median ns per output sample and the median of the
per-round difference against the before bundle, with its interquartile
range. The per-operator kernel figures for the held tom were measured the
same way over 60 rounds.

The bench scripts written for this change were not kept, so the numbers
below cannot be re-run from this folder; `bench.mjs` in the folder above is
the method they followed.

## Results

| Lone Saw carrier (alg 7, the voice filter Off) | ns/sample | against before |
|---|---|---|
| before | 20.52 | — |
| before, again | 20.53 | −0.09 [−0.53, +0.64] |
| this change, off | 21.34 | +0.76 [+0.09, +1.47] |
| one lowpass section | 31.84 | +11.25 [+10.85, +11.91] |
| one lowpass section, `opTrack` 1 | 31.87 | +11.36 [+10.89, +11.95] |
| lowpass and highpass | 35.38 | +14.96 [+14.30, +15.53] |
| feedback 0.5, off / one section | 21.34 / 31.87 | +0.78 / +11.50 |
| `tr909-tom-mid`, off | 22.99 | +1.16 [+0.36, +1.73] |

- **One section on a Saw carrier costs about 11 ns a sample**, about half
  again the lone voice's 20.5 ns; the second section about 3.7 ns more.
  Tracking costs nothing a sample. The voice is latency-bound on the
  section's two-state recurrence more than windsor#362's noise was: in
  the kernel a section costs about 2 ns on a Noise operator, about 3 ns on
  operator D (the first the kernel runs) as a sine, and 9.5 to 12 ns on A,
  B or C (the held tom, measured the same way over 60 rounds); in the
  generic loop it costs 1.4 to 3 ns on a voice that runs at 70 to 80.
- **The kernel writes the section out.** Called, as the generic loop calls
  it, four call sites outran the kernel's inlining budget: the operators
  past the first paid a real call, a section on B cost 16 ns and on C
  27 ns, against 9.5 and 12 written out.
- **Off costs less than a nanosecond a sample, but not nothing.** With no
  cutoff set the kernel tests one hoisted flag per operator per sample and
  does no filter arithmetic, and still reads 0.5 to 1.2 ns slower than
  before on the pitched voices (2.5 to 5 %), and nothing measurable on a
  Noise carrier. Built with this change's other files and `origin/main`'s
  kernel, every voice reads as before (−0.14, −0.07, −0.01 ns), so the cost
  is the kernel's code, not its work. Where the flag sits matters: as the
  liveness test's first term, or bare, it cost a Noise carrier 5 ns and a
  Saw 1.4; as the last term, compared to `true`, nothing on the Noise
  carrier. Hoisting the filter object, a bitmask in place of four flags,
  and loading the filter inside its block all read the same within the
  run-to-run spread of about ±0.5 ns.
