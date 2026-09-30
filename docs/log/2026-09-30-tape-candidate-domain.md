# Map candidate Tape solvers on the signed static boundary cases

Windsor [#197](https://github.com/tacowars/windsor/issues/197) follows the
[overload reference refinement](2026-09-30-tape-overload-reference-refinement.md),
which qualified the last of four signed static references at 48 kHz:
controls 0.5/0.5/0.5 at ±1 (1024×) and controls 1/0/0 at ±100 (8192×).
What the product needs from milestone B is a declared safe input and
control domain. The [research plan](../research/2026-09-30-tape-candidate-domain/README.md)
measures the candidate side of that boundary.

Keep the system unchanged. The GPL-3.0-only CHOW-derived core, knee
conditioning and chain derivative, RK2/RK4 stage arithmetic, playback
kernel and magnitude-20 state guard are reused by import, with no event
alignment, new solver or new conditioning policy. The candidates are
fixed-step RK2 and RK4 at 1, 2, 4 and 8×, eight settings, on the same
512-frame signed pulse, zero history, `knee` policy.

Judge accuracy only where a qualified ruler exists, with the existing 1e-5
raw and full-output limit and no fitting, and only for trajectories that
are finite with zero resets, clips and guard failures. Report survival
separately, at ±1 to ±100 for controls 0.5/0.5/0.5 and 1/0/0, as exactly
that and never as accuracy. The run is one sequential child under a
900-second bound: 288 trajectories.

## Outcome

**No candidate is accurate, and none survives ±100 at 1/0/0.** The run
completed all 288 trajectories in 0.721 seconds on an Apple M1 with Node
24.21.0 and the Float64 source backend. Both rulers matched their SHA-256
and final M, and every trajectory is exactly sign-symmetric.

- **Accuracy.** No setting passes any of the four qualified cases. At the
  center ±1 all sixteen trajectories survive, and the errors fall as the
  step shrinks. The best, RK4/8×, still misses by 4.3× raw (4.32910e-5)
  and 4.0× full (3.99037e-5), with its maxima after the return. At
  1/0/0 ±100 all sixteen trajectories abort on the state guard at host
  times 137–142.875, during the startup transient, before any error can be
  computed.
- **Survival.** Every row is monotone, with no nonfinite slope and no reset
  or clip. The largest surviving levels:
  - at 0.5/0.5/0.5: ±16 for RK2/1× and RK4/1×, ±64 for RK2/2–8× and
    RK4/2×, and ±100 for RK4/4× and RK4/8×;
  - at 1/0/0: ±4 for RK2/1× and RK4/1×, ±8 for RK4/2×, ±16 for RK2/2–8×
    and RK4/4×, and ±32 for RK4/8×.

  Surviving trajectories reach a peak |M| of up to 15.94, against a guard
  of 20 and a ±100 ruler that never exceeds 1.83, so survival says nothing
  about accuracy.

The measurement child was run three times, each under a second. The first
run's anchor check read ruler validity from the wrong level of the ruler
rows, and the third run followed a Prettier pass. All three produced
bit-identical trajectories, and nothing declared changed between them.

## For milestone D

With every candidate surviving, the unchanged knee system can be given
input up to **±4** at both measured controls (±16 at 0.5/0.5/0.5). No
candidate is also accurate at the qualified cases. Since no candidate
survives ±100 at 1/0/0, the product must either bound the field before the
core or use a conditioned system. The choice between those belongs to
milestone D and is not made here. This decision proposes no default, solver,
domain or cost.

Milestone B remains incomplete. Still unresolved: RK4/4× at 1/0/1 and
RK2/8× at 1/0/1 and 1/1/1 on tones, 44.1 and 96 kHz, opposite histories,
dynamic stability, rapid edits, DC/recovery and 60-second runs.
