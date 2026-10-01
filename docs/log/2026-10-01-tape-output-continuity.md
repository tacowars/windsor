# Keep Tape's output continuous when the core's controls move

- **Date:** 2026-10-01
- **Issue:** [windsor#296](https://github.com/tacowars/windsor/issues/296)
- **Follows:** [the integration design](2026-09-30-tape-magnetic-integration-design.md)
  (decision 6 and its amendments), [per-model rows](2026-10-01-tape-per-model-magnetic-rows.md),
  the control-domain research (windsor#290, #295:
  [`docs/research/2026-10-01-tape-control-domain/`](../research/2026-10-01-tape-control-domain/README.md),
  "Output excursions under drive motion")
- **Amends:** decision 6 of the integration design, whose live-switch
  tolerance narrows to the measurement below

## Context

The magnetic core's output is M × gain, where the gain is the
origin-susceptibility normalisation, 1/χ₀, recomputed whenever the core's
three controls move. Two things made that output jump when they did.

1. **Block-rate steps.** Fixed in windsor#289 (PR #293): the stage glides
   the controls and retunes the active cores every sample.
2. **The gain under a frozen M**, this record's subject. dM/dt is
   proportional to dH/dt, so a field held still, or silence after loud
   material, freezes M. Lowering the core's drive lowers χ₀ and raises the
   gain under that frozen M: at a fixed width the gain at drive 0 is about
   600 times the gain at drive 1. #290 read peaks up
   to 242 times the conditioned field under held DC, and the DC block
   after the core turned each into a decaying thump. The Advanced panel
   (windsor#291) will let users turn drive across [0, 1] at widths
   [0.05, 0.62], so this has to hold across that box, not just between the
   model rows.

## Decision

**Option (b): rescale M at every retune so that M × gain is continuous.**
`TapeMagneticCore.retune` computes the new gain, multiplies M by the old
gain over the new, and stores the new gain. A gain that does not change
leaves M exactly as it was.

- **Bit-identical at constant controls.** The stage calls `retune` only
  while the controls glide, so a settled render executes exactly the code
  it did before. The Tape goldens and `tapeMagneticGolden` pass unchanged.
- **No allocation, portable.** One comparison, one division and one
  multiplication per retune, on doubles already in fields, with no
  transcendental `Math` call. `inserts/tapeAllocation.test.ts` passes.
- **The state.** With drive falling, M shrinks in proportion to the new
  susceptibility, as a small signal's magnetization would, so it stays
  inside the narrower loop's reach. With drive rising, M grows to keep the
  output: under a field held at the guard (4, conditioned to 2.5) it reached
  4.97, past Ms (2 at most) but a quarter of the state guard (20). Keeping
  the output with M = out × χ₀ bounds it at about 2.5 × 1.94, the conditioned
  field times the largest χ₀ in the box. The next movement of the field
  pulls M back to the loop. Releasing the held field then swings to 1.230 of
  the field, where constant drive 0 releases to 1.216.

## Measurement: the three options

Each option was built on the shipped core in a scratch test (not
committed) that replaced `TapeMagneticCore.prototype.retune` in the
source `TapeDsp`:

- **(a)** the gain glides on its own toward the retuned value, with time
  constant 0.1 s or 1 s;
- **(b)** M is rescaled, as shipped;
- **(c)** the gain's change is limited to 20 dB/s or 6 dB/s.

**Setup.** The whole path at 48 kHz, at 2× and 4×, with the Bias and model
EQ bypassed. Drive 0 or +32 put a full-scale input at field 1 or 4. Each run
is at one corner of the box: width {0.05, 0.62} × saturation {0, 1}. The
core drive goes from 1 to 0 as a jump (the 10 ms glide) or a 1 s sweep. Each
case starts after 0.53 s of silence in which the controls settle.

**Signals.**

- **Held DC:** a 5 ms raised-cosine onset, held through the motion and for
  0.1 s after it, then released, with 0.1 s of tail.
- **Tone:** a 300 Hz sine.
- **Silence:** 0.1 s of silence after a 0.2 s tone, then the motion.
- **Model switch in silence:** a separate walk of all 42 ordered model
  pairs through the heard path. Each pair is 0.1 s of tone on the first
  model, 50 ms of silence, then the switch and 0.1 s more silence.

**The figure** is the worst |output| from the motion on, as a multiple of
a reference:

- for held DC and tones, the larger peak of the same case at constant
  drive 1 and at constant drive 0;
- for silence and the model switch, the tone's steady peak.

The worst over every case is shown. 2× and 4× agree within 0.2%, and
the larger of the two is given.

| Option | Held DC | Tone | Silence | Model switch in silence |
|---|---|---|---|---|
| none (the shipped core before) | 390.2 | 1.040 | 47.18 | 0.232 |
| (a) glide, τ = 0.1 s | 185.2 | 0.832 | 15.73 | 0.070 |
| (a) glide, τ = 1 s | 26.59 | 1.249 | 2.267 | 0.012 |
| **(b) rescale M** | **0.990** | **1.000** | **0.000** | **0.012** |
| (c) limit, 20 dB/s | 4.848 | 0.923 | 0.087 | 0.015 |
| (c) limit, 6 dB/s | 1.389 | 1.126 | 0.006 | 0.015 |

No case of any option reset the core.

### Why (a) and (c) lose

These figures flatter (a) and (c). Both leave M where it was and only
delay the gain. A full drop of drive at width 0.05 raises the gain about
600 times (55.6 dB):

- at 6 dB/s the gain takes 9.3 s to arrive;
- with τ = 1 s it is within 1% after 4.6 s.

These cases end 0.2 s after the motion, so the held field is released
before most of the excursion has built up. A field held longer would
release under the full gain, as with no fix at all.

Meanwhile every quiet signal comes out too quiet by up to 55 dB, recovering
over seconds. The slower settings, which do best on held DC, also overshoot
tones: 1.249 for (a) at 1 s and 1.126 for (c) at 6 dB/s.

Only (b) changes the state, so only (b) removes the excursion rather than
slowing it down, and it does so at once.

## The gates (decision 3 of the issue)

All on the shipped bundle, Node 24.20.0 on the Apple M1 (arm64), at 44.1,
48 and 96 kHz, at 2× and then 4× on one DSP per rate, with zero resets. The
core's arithmetic is portable (`tapePortableMath.ts`), so x64 reads the
same bits.

| Gate | Test | Before | After | Allowed |
|---|---|---|---|---|
| Live model switch under a full-scale tone, worst sample over the larger steady peak | `tapeModelSwitch` | 1.0213 | 1.0189 | 1.0199 |
| The same walk, lowest cycle peak over the smaller | `tapeModelSwitch` | 0.9599 | 0.9862 | 0.9852 |
| Model switch in silence after a full-scale tone, over the tone's steady peak | `tapeOutputContinuity` | 0.2402 | 0.0798 | 0.085 |
| Drive 1 → 0 under a held field at the guard, over the conditioned field | `tapeOutputContinuity` | 57.3 | 0.887 | 0.892 |
| Drive 0 → 1 under the same held field | `tapeOutputContinuity` | 2.88 | 1.230 | 1.235 |
| Drive 1 → 0 under a full-scale tone at field 1 and 4, over the larger steady peak | `tapeOutputContinuity` | 1.0034 | 1.0004 | 1.005 |
| Largest \|M\| in those drive trials | `tapeOutputContinuity` | 1.67 | 4.97 | 5.5 |

**What the drive trials cover.** They run at the four corners of the box
above, as a jump and as a 50 ms sweep. The test writes the stage's target
after each block's `configure`, as the panel will.

**How the bounds are set.** Each is its measurement plus half a point,
except the live switch. Its tolerance is the measurement plus a tenth of a
point, which keeps it under the issue's 2% target. The arithmetic is
portable, so the margin only has to absorb a harmless change, not a
platform.

**Reading the silence figure.** 0.0798 is the tone's own tail through the
DC block, 20 ms after it stops; the switch adds nothing to it.

**Reading the held figures.** They are shorter cases than the comparison
above (40 ms holds), so the "before" is 57.3 where the longer holds
read 390.

**Cause 1 is gone.** The walk's worst sample, 1.0189, is the glide's
intermediate states, not a step. The amendment of 2026-10-01 measured the
whole path's steady peak at 1.014 of the larger end partway between
Ferric and Metal, before any glide. The lowest cycle peak rose from 0.9599
to 0.9862: holding M × gain removes the dip the normalisation used to put
into the glide.

## Cost

A Node-side relative measurement suffices here, for two reasons:

- **The settled render is unchanged.** It runs the same code as before:
  `retune` is not called, and the goldens are bit-identical.
- **The Chrome harness never retunes.** #250/#254's offline harness edits
  the insert's Drive, not the core's controls.

The only new work is in a glide: three operations per retune.

**The measurement**
([`docs/research/2026-10-01-tape-continuity-cost/`](../research/2026-10-01-tape-continuity-cost/README.md)):
four shipped processors in Node 24.20.0 on the recorded M1, the old bundle
and the new one interleaved, steady and with the model switching every 16
quanta (so the cores retune every sample).

The machine was loaded by other work, so no cost was resolved. The after /
before ratios were 1.030 and 1.011 for the steady renders, which run
identical code, so that is the noise floor. The switching renders read
0.980 (2×) and 1.009 (4×), inside it. The bundle's code diff is the three
lines of `retune`.

**The 1.33 ms target.** #254's Chrome figures stand: the shipped 2× path at
1.087 ms steady and 1.084 ms with edits (four instances, Chrome 154 on the
M1), within 1.33 ms. The shipped 4× path is at 2.075 ms, outside it. Those
renders execute no line this change touches.

## Format

No version bump: renders change only while the core's controls move, and
no saved field changes meaning.

## Consequences

The Advanced panel (windsor#291) can move drive anywhere in the box without
a thump: the gate above holds the drive motion that reached 242 times the
field in #290 to under the field. Width and saturation change the gain
less, or not at all: χ₀ does not depend on Ms. Width's motion is covered
by the same rescale, but has no gate of its own here.
