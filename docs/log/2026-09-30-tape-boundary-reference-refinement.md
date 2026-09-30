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


## Outcome and next boundary

The complete 28-trajectory/24-comparison run took 26.973 seconds on the
recorded M1/Node Float64 backend; all shared coarse summaries and errors
match #169 exactly. Both center signed unit pulses qualify at the finest
256/512/1024× triple under the unchanged raw/full 1e-7 criterion. Both
controls-1/0/0 signed ±100 pulses remain unqualified: their finest errors
are 6.85460e-7 raw and 8.98369e-7 full, and the preserved 16× trajectories
still fail the state guard during return. Finer finite output and final
remanence do not conceal either failure type.

Stage evidence records large conditioned derivatives near field zero,
large coarse stage updates and magnetic branch changes. The sampled
coarse denominator minimum remains above its guard floor. This does not
prove a continuous stability bound or that slew is the sole cause.
See the report for stage states, caps and numerical uncertainty.

The next recommendation is one new bounded, unchanged-system reference
comparison at 1024/2048/4096/8192× for the two remaining signed extreme
pulses at 48 kHz, under the same gates and 900-second bound. Its cost and
qualification are unknown. If it fails, preserve the blocker and refine
an event-localization or derivative-consistent conditioning experiment;
do not extend an automatic ladder or silently clip dH. No follow-up is
implemented by this decision. Full static/dynamic domains, candidate
corner accuracy, browser cost and eventual in-app audition remain pending.
