# Refine signed Tape boundary references within a fixed budget

Windsor [#178](https://github.com/tacowars/windsor/issues/178) follows the
[static conditioning decision](2026-09-30-tape-static-conditioning.md).
Keep the existing knee system unchanged and isolate its four immediate
48 kHz zero-history blockers: center ±1 and controls 1/0/0 ±100 pulses.
The [research plan](../research/2026-09-30-tape-boundary-reference/README.md)
declares 28 RK4 trajectories at 16–1024×, a 900-second numerical bound and
the unchanged 1e-7 maximum absolute raw/full precision criterion.

Instrument actual imported RK stages without changing their slope or guards.
Preserve magnetic branch/denominator evidence alongside field zero/knee and
velocity changes; amplitude bounding does not establish bounded slew, and
large slew alone is not established as the sole cause. Same-time midpoint
trial states are diagnostic stage transitions, not exact physical crossings.

Require both successive raw/full pairs of the finest scheduled triple.
Preserve failed coarse levels and distinguish finite precision misses from
invalid states. Fixed-8× observation is diagnostic, not an alternative gate.
Timeouts, missing rows, failed baseline identity and partial evidence cannot
qualify a reference. A complete blocker report is a valid task outcome; no
threshold relaxation, hidden derivative clipping, extra refinement or new
system is authorized by failure of this ladder.

Prior evidence, shipping DSP/UI, schemas, presets and goldens remain intact.
Milestone B is not complete. Any new conditioning model or numerical method
requires its own next task and independent reference qualification, before
full dynamic and eventual product qualification.
