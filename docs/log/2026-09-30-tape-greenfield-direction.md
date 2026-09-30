# Develop Tape as a greenfield effect

The user has removed old-song compatibility as a requirement for Tape
phase 3. Windsor has no users whose saved songs need the old sound carried
forward. Prefer sound quality, clean architecture, good coding practices
and measured performance. This records the direction for Windsor #149 and
[epic #146](https://github.com/tacowars/windsor/issues/146).

## What changes

Old-song audio parity, old defaults, legacy parameter meanings, seeded
render parity and compatibility migrations/shims are not acceptance
requirements for the new Tape design. Breaking changes are acceptable
when they produce a cleaner solution. Do not keep historical product
branches solely to preserve old files or renders.

The requirement for an untouched legacy path and an explicit opt-in magnetic
mode in [the prototype decision](2026-09-30-tape-magnetic-prototype.md)
and [the phase-2 plan](2026-09-30-expand-tape-controls-and-measure-cost.md)
is superseded. Their research and historical implementation records remain
intact. The format-version convention still identifies incompatible
documents; a new incompatible format need not provide an upgrade.

One clean implementation is preferred when the evidence supports it.
Inexpensive and magnetic options may be useful if measured CPU cost
justifies that tradeoff. An opt-in magnetic mode is an option, not a
compatibility obligation. No product default, mode name, solver,
oversampling setting or numerical meaning of "significantly more expensive"
has been selected.

## What remains required

- Current-format save/load carries every chosen mode and parameter.
  Song snapshots remain self-contained, and library edits remain isolated
  from saved songs.
- Audio hot paths remain deterministic and allocation-free. Intentional
  DSP/schema changes have a decision record and clear format identity;
  changed goldens have meaningful replacement assertions. Old golden
  parity does not constrain the new sound.
- Numerical qualification, truthful performance measurements and licence
  attribution still apply. Preserve the CHOW-derived core's GPL provenance;
  it is distinct from the shipping effect's CC0 REELS provenance.
- Resolve fixed delay, dry/wet alignment, bypass, parallel routing,
  initialization/preallocation and any actual mode transitions before
  integration. The insert contract currently has no host latency
  compensation; removing compatibility does not solve timing problems.
- The user still auditions the eventual sound with level-matched material
  and reviews any new UI. The previous research merge approvals do not
  approve future audible behavior.

## Research state and next boundary

[PR #148](https://github.com/tacowars/windsor/pull/148), merged as
`6ca03ac2434e401a40ec455454f4ca7966506ba3`, delivered
[#147](https://github.com/tacowars/windsor/issues/147)'s reference/error
diagnosis. Its acceptance criteria permitted a documented reference blocker;
closing that task does not mark milestone A as qualified.

The preserved [report](../research/2026-09-30-tape-reference/README.md)
qualifies the analytic and both frozen-reconstruction references on all
72 normal cases. The unchanged full path qualifies only 30/72; its worst
32× to 64× residual is -57.82 dB. These are saved numerical results, not a
new run or a browser CPU measurement. The full filtered reference remains
the immediate prerequisite for candidate certification.

[#150](https://github.com/tacowars/windsor/issues/150) is the next bounded
research task: evaluate a continuous field and its derivative consistently
at integration stages, separate integration refinement from reconstruction
and output-filter refinement, and compare both RK2/RK4 with the unchanged
alpha-transform baseline. Preserve every failed gate and both prior
experiments. A converged frozen interpolant alone is not qualification of
the full filtered system.

Reference margins remain -70 dB low/mid and -60 dB high/two-tone, with
candidate targets of -60/-50 dB. Neither the greenfield waiver nor a failed
reference authorizes weaker targets or scoring reset-generated silence.

After that prerequisite: condition the core and qualify bounded domains,
signed overload recovery, rapid edits, DC and 60-second stability; then
qualify resampling response and measure realistic browser cost against the
phase-2 baseline. The target of four instances below half a 48 kHz quantum
(1.33 ms) remains a target, not an achieved result or the user's definition
of a significant CPU gap. Existing coarse per-node counters cannot certify
it. Only then choose the product path(s), resolve integration and audition.

Physical playback losses, a transport/wear rewrite, tape stop/start and
preset-picker cleanup remain later work. The intended balance is studio
quality and creative wear.
