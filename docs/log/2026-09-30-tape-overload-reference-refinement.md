# Bound the signed Tape overload references at 1024–8192×

Windsor [#188](https://github.com/tacowars/windsor/issues/188) follows the
[bounded boundary refinement](2026-09-30-tape-boundary-reference-refinement.md),
which left one static blocker: the controls-1/0/0 signed ±100 knee pulses
at 48 kHz, whose 512→1024× errors missed the 1e-7 criterion by about 7× raw
and 9× full. The [research plan](../research/2026-09-30-tape-overload-reference/README.md)
declares one fixed RK4 ladder, 1024/2048/4096/8192×, for those two
zero-history cases: eight trajectories, six comparisons, a 900-second
numerical bound and the unchanged raw/full criterion.

Keep the system unchanged. The GPL-3.0-only CHOW-derived core, continuous
reconstruction, knee chain derivative, RK4 integrator, playback kernel,
state guard and #183's stage instrumentation and evidence functions are
reused by import; only the constants table is new. #183's baseline check
is bound to its own table, so a small new evidence file adds the 1024×
anchor, the location of each maximum and the outcome classification.

Qualify a reference only on both successive raw/full pairs of the finest
scheduled triple, 2048/4096/8192×, with complete, finite, reset- and
clip-free trajectories, a complete run and an exact 1024× anchor against
#183's saved rows. The 1024→2048× pair is trend only. Fixed-8× observation
is diagnostic. No threshold relaxation, 16384× level, retry or new system.

## Outcome

**Both references qualified.** The complete run took 88.116 seconds on the
recorded M1/Node Float64 backend. Both 1024× trajectories reproduce #183's
saved rows exactly. All eight trajectories are finite with zero resets and
clips. The finest pairs' errors are 7.49728e-8 raw / 4.47457e-8 full at
2048→4096× and 3.69236e-8 raw / 2.35975e-8 full at 4096→8192×, equal for
both signs; 1024→2048× still misses (2.62047e-7 raw, 7.47084e-7 full). No
row of this matrix remains unqualified.

The finest raw maxima fall at host frame 143, just after the startup
field-zero crossing, and the full-output maxima at frames 157–158. Errors
fall only about 2× per halving of the step between the two finest pairs,
roughly first order, which points at a localized event rather than smooth
RK4 truncation. That is an observed trend, not a proven order.

This removes one static blocker. It does not complete milestone B,
qualify any candidate solver, rate, history or control domain, or
authorize dynamic or product work.

## Next boundary

The smallest justified follow-up is event localization at the measured
maximum: a separately declared task that locates the field-zero crossing
and adjacent branch changes near frame 143 and compares event-aligned with
fixed-step error there. A derivative-consistent conditioning experiment is
the alternative if localization does not account for it. Neither is
implemented by this decision, and no refinement past 8192× is recommended.
RK4/4× at 1/0/1, RK2/8× at 1/0/1 and 1/1/1, dynamic stability, rapid edits,
opposite histories, DC/recovery and 60-second 44.1/48/96 kHz runs remain
unresolved, before browser cost and the user's in-app audition.
