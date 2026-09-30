# Test field-event-aligned RK4 against the 8192× overload ruler

Windsor [#192](https://github.com/tacowars/windsor/issues/192) follows the
[bounded overload refinement](2026-09-30-tape-overload-reference-refinement.md),
which qualified both signed ±100 knee pulses at 8192× but found the error
shrinking only about first order, with its raw maximum at frame 143, just
after the startup field-zero crossing. The
[research plan](../research/2026-09-30-tape-event-alignment/README.md)
declares one bounded experiment: locate the input field's events and test
whether RK4 steps aligned to them let a cheaper factor qualify.

Keep the system unchanged. The GPL-3.0-only CHOW-derived core, continuous
reconstruction, knee chain derivative, RK4 stage arithmetic, playback
kernel, fixed-8× observation and state guard are imported. The aligned
integrator only chooses step boundaries: it inserts a node at each located
field zero, knee crossing and dH/dt sign change, never moves a uniform
node, and calls the imported `step` per substep with directly evaluated
field values. Tests prove it reproduces #183's fixed renderer bit for bit
with no inserted node, and 128× bit for bit when every 64× step is split
at its midpoint. The ruler is #188's saved 8192× rows, pinned by SHA-256
and final M; fixed 1024× must reproduce #188's 1024× rows exactly.

Run factors 64–1024×, fixed and aligned, both cases: 20 trajectories under
a 900-second bound. A factor qualifies as a cheaper reference only if it
and 2F pass the unchanged 1e-7 raw and full criterion for both cases in a
complete run with the anchor and ruler held.

## Outcome

**(b): alignment helps, and the residual sits among unaligned state
switches; no cheaper reference qualifies.** The complete run took 10.265
seconds on the recorded M1/Node Float64 backend. Ruler and anchor held;
every trajectory is finite with zero resets and clips.

Event counts equal #190's 30 field-zero, 26 knee and 252 velocity at every
factor. 195 of the velocity changes are roundoff sign flips of a flat
field's derivative at integer and half-integer frames and sit on uniform
nodes; 111 genuine events per case are inserted.

Alignment lowers the worst raw/full error by factors of only 1.00–1.33
from 64 to 512×, where the startup ringing dominates, and at 512× it
raises the full error at frame 288. At 1024×, where the fixed method
stalls, it lowers the worst error 27.8×: aligned 1024× errors are 2.58e-8
raw and 3.39e-9 full, against 2.60e-7 and 7.16e-7 fixed. They pass 1e-7, but 1024× has no 2048×
row and aligned 512× misses, so nothing qualifies. The observed orders
are pre-asymptotic (means 4.58 fixed, 5.93 aligned).

The aligned 1024× maxima, frames 143 and 159, are not at an aligned field
event; the host frame before each holds unaligned irreversible- or
series-branch switches, which meets the declared test for (b). Two limits
are recorded. Every frame from 129 to 287 holds such a switch, so the test
cannot tell cause from coincidence. And the 2.58e-8 raw residual is below
#188's own 4096→8192× difference at frame 143, so it is at the ruler's
resolution.

This qualifies no candidate solver, rate, history or control domain.
Milestone B remains incomplete, and no dynamic or product work is
authorized.

## Next boundary

The smallest justified follow-up is state-event localization: locate the
irreversible- and series-branch switches inside a step and split there,
measured against a ruler finer than #188's 8192× rows, which cannot
resolve the residual that remains. It is not started here. No bounded-slew
field, dH clipping, denominator regularization, modified equation or new
mapping is implemented. RK4/4× at 1/0/1, RK2/8× at 1/0/1 and 1/1/1,
dynamic stability, rapid edits, opposite histories, DC/recovery and
60-second 44.1/48/96 kHz runs remain unresolved, before browser cost and
the user's in-app audition.
