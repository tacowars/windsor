# bass-digital clip headroom, and how it was measured

- Date: 2026-09-02
- Links: issue #78 · decision `2026-08-31-audio-worklet-single-file` (the
  worklet stays one file, so the PRNG is inline) ·
  `docs/design/audio-architecture.md` §4, §6.1

## Decision

1. **Every render through `__fixtures__/workletHarness.ts` is seeded**
   (`DEFAULT_SEED`), not just the clip assertion #78 was filed against.
   `create(patch, maxVoices, null)` is the explicit opt-out and is what the
   one game-path test uses.
2. **`bass-digital`'s `patch.volume` drops 0.17 → 0.14** (−1.68 dB). Its
   timbre — operator ratios, levels, filter drive and resonance — is
   untouched.
3. **The margin is set against the worst case over the whole start-phase
   space, not the worst of a seed sample.** At 0.14 that worst case is
   **0.939** at the test's note 60 / velocity 0.9 (6.1 % headroom) and
   **0.963** at velocity 1.0 (3.7 %). Both are measured, and the phases that
   produce the first are pinned in `fmProcessor.test.ts`.

## Why

**Seeding the whole harness.** The processor draws free-running operator
phase from `Math.random`, so an unseeded assertion about a level is a fresh
draw from a distribution every run. That is what #78 is: the clip assertion
failed once at peak 1.011 and passed on re-run. The same hazard sits under
every other level-ish assertion in the file (`peak > 0.002`,
`maxStep < 0.25`), so seeding only the one assertion that has already failed
would leave the rest waiting their turn. Coverage of the random space is
better served by a deliberate sweep, which is cheap here, than by one
unrepeatable draw per CI run.

**Why the sweep the ticket asked for was not enough.** A seed sweep samples
the peak distribution; it does not bound it. At the old volume, 3 of 4,096
seeds exceeded 1.0 and the worst was 1.0040 — but the same sweep extended to
65,536 seeds found 1.0627 at the *trimmed* volume of 0.16. The tail keeps
paying out as the sample grows, so "worst over N seeds" moves with N and
cannot answer "does this preset clip".

It can be answered exactly, because the space is small. `bass-digital` has no
noise operator, no LFO and no `panRandom`, so its entire exposure to
randomness is four operator start phases — and `phaseFree: false` plus an
explicit `op.phase` renders any point in that space. Reconstructing the
mulberry32 draw order confirmed the model end to end: the phases computed for
a seed reproduce that seed's peak to four decimals. Multi-start hill climbing
over the 4-D cube (900 climbs at the chosen volume, 600 of them at note 60 /
velocity 0.9) then bounds the preset instead of sampling it. The peak lands
80–150 ms into the note — it is the sustained waveform's crest factor moving
with operator alignment, not a note-on transient, so there is nothing here to
fix in the DSP.

**Why trim the volume rather than the voicing.** `patch.volume` is a level;
operator ratios, levels, filter drive and resonance are the sound. −1.68 dB
on one part is recoverable anywhere downstream (the channel strip's fader,
`mix.ts`) and audibly nothing; a resonance or drive change to lower the crest
factor would alter a preset tacowars authored, to buy the same headroom. The
ticket prescribed the volume trim and it is also the smaller claim on
someone else's judgement.

## Punted / alternatives

- **Loosening the assertion to a tolerance above 1.0.** Ruled out by the
  ticket, and correctly: clipping is the property the test exists to catch.
- **Seeding only the clip test.** Rejected above.
- **Trimming to clear velocity 1.0 by 5 % as well** (volume ≈ 0.135). The
  test renders velocity 0.9 and the trim already clears velocity 1.0 outright;
  a further −0.3 dB buys margin against a condition nothing asserts.
- **The other presets are not re-levelled here.** The same phase-space search
  run across the preset set is reported on the PR. `bass-digital` was the
  ticket; re-levelling authored presets is a mix decision for tacowars, and the
  seeded harness means none of them can flake the suite in the meantime.
- **An `xorshift32` PRNG.** The inline generator is mulberry32 instead —
  identical, line for line, to `mulberry32` in
  `packages/shared/src/terrain/heightmap.ts`, so the repo has one seeded
  generator rather than two. It is copied, not imported, because the worklet
  must stay import-free (`2026-08-31-audio-worklet-single-file`).
- **A zero xorshift seed.** The per-voice noise and LFO generators are
  xorshift32, whose fixed point is 0; a drawn zero would emit a constant
  forever. It is a 2^-32 accident from `Math.random` but a reachable,
  reproducible one from a swept seed, so `randomSeed32()` excludes it.
