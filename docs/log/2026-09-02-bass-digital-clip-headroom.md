# bass-digital clip headroom, how it was measured, and what the measurement found next door

- Date: 2026-09-02
- Links: issue #78 · decision `2026-08-31-audio-worklet-single-file` (the
  worklet stays one file, so the PRNG is inline) ·
  `docs/design/audio-architecture.md` §4, §6.1

## Decision

1. **Every render through `__fixtures__/workletHarness.ts` is seeded**
   (`DEFAULT_SEED`), not just the clip assertion #78 was filed against.
   `create(patch, maxVoices, null)` is the explicit opt-out and is what the
   game-path tests use.
2. **The all-presets clip assertion becomes a 64-seed sweep**, because seeding
   one render and stopping there would trade a rare true failure for a
   permanent false pass. See "What seeding one render would have hidden".
3. **`bass-digital`'s `patch.volume` drops 0.17 → 0.14** (−1.68 dB). Its
   timbre — operator ratios, levels, filter drive and resonance — is
   untouched.
4. **The margin is set against the worst case over the whole start-phase
   space, not the worst of a seed sample.** At 0.14 that worst case is
   **0.939** at the test's note 60 / velocity 0.9 (6.1 % headroom) and
   **0.963** at velocity 1.0 (3.7 %). Both are measured, and the phases that
   produce the first are pinned in `fmProcessor.test.ts`.
5. **Three sibling presets are trimmed on the same evidence**: `weapon-zap`
   0.52 → 0.45, `ai-voice` 0.66 → 0.62, `horde-horn` 0.24 → 0.23. This goes
   past the letter of #78, which named one preset; it is here because the
   sweep the ticket asked for found them, and because decision 2 makes the
   suite fail on them rather than look away. Each is a one-line revert if Pat
   would rather re-level them by ear.

## Why

**Seeding the whole harness.** The processor draws free-running operator
phase from `Math.random`, so an unseeded assertion about a level is a fresh
draw from a distribution every run. That is what #78 is: the clip assertion
failed once at peak 1.011 and passed on re-run. The same hazard sits under
every other level-ish assertion in the file (`peak > 0.002`,
`maxStep < 0.25`), so seeding only the one assertion that has already failed
would leave the rest waiting their turn.

**What seeding one render would have hidden.** A single seeded render is not
a weaker version of a random one — it is a *permanent* verdict on one draw.
The cross-model review of this branch caught exactly that: with the harness
seeded and the all-presets assertion still rendering once, `weapon-zap`
peaked 0.730 at `DEFAULT_SEED` and 1.081 at seed 1261. The suite would have
gone green forever over a preset that clips on roughly 1 draw in 900. So the
assertion sweeps 64 seeds instead, which is 64 more than it took before and
takes the same 64 every run.

**Why the sweep the ticket asked for was not enough for `bass-digital`.** A
seed sweep samples the peak distribution; it does not bound it. At the old
volume, 3 of 4,096 seeds exceeded 1.0 and the worst was 1.0040 — but the same
sweep extended to 65,536 seeds found 1.0627 at a *trimmed* volume of 0.16.
The tail keeps paying out as the sample grows, so "worst over N seeds" moves
with N and cannot answer "does this preset clip".

It can be answered exactly for this preset, because the space is small.
`bass-digital` has no noise operator, no LFO and no `panRandom`, so its
entire exposure to randomness is four operator start phases — and
`phaseFree: false` plus an explicit `op.phase` renders any point in that
space. Reconstructing the mulberry32 draw order confirmed the model end to
end: the phases computed for a seed reproduce that seed's peak to four
decimals. Multi-start hill climbing over the 4-D cube (900 climbs at the
chosen volume, 600 of them at note 60 / velocity 0.9) then bounds the preset
instead of sampling it. The peak lands 80–150 ms into the note — it is the
sustained waveform's crest factor moving with operator alignment, not a
note-on transient, so there is nothing here to fix in the DSP.

That method does not generalise to the whole set: `weapon-zap` has a noise
operator, whose per-voice seed the phase search holds fixed. For the siblings
the covering measurement is therefore a 16,384-seed sweep, which reaches every
random input the processor has, and the numbers in decision 5 come from it.

**Why trim the volume rather than the voicing.** `patch.volume` is a level;
operator ratios, levels, filter drive and resonance are the sound. −1.68 dB
on one part is recoverable anywhere downstream (the channel strip's fader,
`mix.ts`) and audibly nothing; a resonance or drive change to lower the crest
factor would alter a preset Pat authored, to buy the same headroom. The
ticket prescribed the volume trim and it is also the smaller claim on someone
else's judgement.

## Measurements

Peak of one held note (note 60, velocity 0.9, `noteOff` at frame 12,000,
51,200 frames at 48 kHz) — the render `fmProcessor.test.ts` makes.

Every preset was swept over 16,384 seeds (4,096 for the two slowest,
`saw-arp` and `drone-sqr`), before and after any trim.

| Preset | volume | worst peak before | worst peak after | headroom |
|---|---|---|---|---|
| `weapon-zap` | 0.52 → **0.45** | 1.0811, **18 seeds over 1.0** | 0.9356 | 6.4 % |
| `ai-voice` | 0.66 → **0.62** | 0.9976, none over | 0.9372 | 6.3 % |
| `horde-horn` | 0.24 → **0.23** | 0.9737, none over | 0.9342 | 6.6 % |
| `bass-digital` | 0.17 → **0.14** | 1.0040 at 4,096 seeds, **3 over**; 1.0627 at 65,536 even after a trim to 0.16 | 0.8638 sampled — and **0.9393 as a bound**, from the phase-space search | 6.1 % against the bound |
| `build-thunk` | 0.89 | — | 0.8968 | 10 % |
| `snare` | 1.0 | — | 0.8465 | 15 % |
| `lead-bell` | 0.97 | — | 0.7225 | 28 % |
| `pickup-blip` | 1.0 | — | 0.6788 | 32 % |
| `kick` | 1.0 | — | 0.6441 | 36 % |
| `drone-sqr` | 0.17 | — | 0.6354 | 37 % |
| `saw-arp` | 0.17 | — | 0.5171 | 48 % |
| `hat` | 1.0 | — | 0.4535 | 55 % |
| `pad-drift` | 0.44 | — | 0.1962 | 80 % |
| `sub-drone` | 1.0 | — | 0.1350 | 87 % |

Note the two kinds of number in the `bass-digital` row. 0.8638 is the worst
of 16,384 draws; 0.9393 is the worst the preset can do at any start phase.
Everywhere else in this table only the sampled kind was available, so those
headrooms are floors and the true worst case sits somewhere above them.

## Punted / alternatives

- **Loosening the assertion to a tolerance above 1.0.** Ruled out by the
  ticket, and correctly: clipping is the property the test exists to catch.
- **Seeding only the clip test**, or seeding the harness and leaving the
  all-presets assertion at one render. Rejected above; the second was a real
  defect in an earlier revision of this branch.
- **Trimming `bass-digital` to clear velocity 1.0 by 5 % as well** (volume
  ≈ 0.135). The test renders velocity 0.9 and the trim already clears velocity
  1.0 outright; a further −0.3 dB buys margin against a condition nothing
  asserts.
- **Re-voicing rather than re-levelling the three siblings.** Same reasoning
  as `bass-digital`, and with less measurement behind it — a level is a level,
  a filter is a decision.
- **An `xorshift32` PRNG.** The inline generator is mulberry32 instead —
  identical, line for line, to `mulberry32` in
  `packages/shared/src/terrain/heightmap.ts`, so the repo has one seeded
  generator rather than two. It is copied, not imported, because the worklet
  must stay import-free (`2026-08-31-audio-worklet-single-file`).
- **Leaving a zero xorshift seed alone.** The per-voice noise and LFO
  generators are xorshift32, whose fixed point is 0; a voice that drew it
  emits dead DC for as long as it sounds. It is a 2^-32 accident from
  `Math.random` and was never worth a branch, but a swept seed makes it
  reachable and reproducible, so `randomSeed32()` excludes it. **This is the
  one behavioural change on the unseeded game path**, and it is asserted on
  that path with `Math.random` pinned at 0.
