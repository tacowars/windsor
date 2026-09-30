# Declare Tape candidate survival on |H| ≤ 4 across the cube, three rates and 60 seconds

Windsor [#204](https://github.com/tacowars/windsor/issues/204) follows the
[candidate domain](2026-09-30-tape-candidate-domain.md). That decision
found that every cheap candidate survives signed static ±4 pulses at two
controls, on the unchanged knee system. It is a child of
[epic #146](https://github.com/tacowars/windsor/issues/146) under the
[greenfield direction](2026-09-30-tape-greenfield-direction.md). The
[experiment](../research/2026-09-30-tape-dynamic-survival/README.md) tests
that declared domain, **field input |H| ≤ 4**, where a product would
actually use it.

Keep the system unchanged. The GPL-3.0-only CHOW-derived core, knee
conditioning and chain derivative, RK2/RK4 stage arithmetic, playback
kernel and magnitude-20 state guard are reused by import. The candidates
are fixed-step RK4 at 2, 4 and 8× and RK2 at 8×, `knee` policy, at 44.1,
48 and 96 kHz. Part 1 runs #197's 512-frame ±4 pulses at the eight corners
of the control cube and its center (216 trajectories). Part 2 runs one
60-second program per setting and rate (12 trajectories). The program has
a closed-form field and derivative: tones ramping to peak 4, 50 ms control
edits over a seeded schedule that visits every corner and the center twenty
times, the corners 1/0/1 and 1/1/1 on tones, held ±4 DC, opposite ±4
histories at 1/0/0, ±4 spikes and silence. **Survival** means finite with
zero resets, clips and guard failures. One sequential child ran under a
900-second bound.

Three details the issue left open are declared in the experiment. Every
level change is a 5 ms raised-cosine edge, including the opposite
histories: a jump in a closed-form field carries no derivative, and the
core would never see it. The first DC edge crossfades from the tones, so
the field is continuous. Each block of the schedule adds one seeded
interior point to the nine cube points, and remanence is the mean M over a
segment's last 0.1 s.

## Outcome

**The declared domain holds.** The run completed all 228 trajectories in
266.8 seconds. Every setting survives at every rate, at all nine control
points, at both signs, and through every segment of the program. There is
no guard failure, reset, clip or nonfinite slope, and the largest peak |M|
is 2.992 against the guard at 20. After the last spike, five seconds of
silence leave the remanence unchanged. The environment and every segment
record are in the README and report.

The milestone B **survival declaration** this supports: on the unchanged
knee system, with field input |H| ≤ 4 and controls anywhere in [0,1]³, at
44.1, 48 and 96 kHz, RK4 at 2, 4 and 8× and RK2 at 8× survive. The controls
were sampled at the corners and center, plus 20 seeded interior points in
the program.

**This is survival, not accuracy.** #197 found no candidate within 1e-5 of
the qualified references, and #167's tone gates remain the accuracy
record. As a diagnostic with no gate, the candidates differ from RK4/8× by
up to 0.51 raw and 0.57 full output (RK4/2×), 0.08 / 0.09 (RK4/4×) and
0.034 / 0.038 (RK2/8×). The largest differences are on the tones at 1/0/1,
the corner where #167 recorded misses.

## For milestone D

No default, solver or product bounding method is proposed. Milestone D
chooses how the product keeps the field inside |H| ≤ 4.

Milestone B remains incomplete. Still unresolved: candidate accuracy on
the corner tones (RK4/4× at 1/0/1, RK2/8× at 1/0/1 and 1/1/1), resampling
and browser cost (C), latency, bypass and integration (D), and the user's
in-app audition (E).
