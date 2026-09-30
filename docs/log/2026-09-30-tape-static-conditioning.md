# Keep static Tape conditioning separate from dynamic stability

Windsor #167 is a research-only child of milestone B in
[epic #146](https://github.com/tacowars/windsor/issues/146). The
[experiment](../research/2026-09-30-tape-conditioning/README.md) keeps the
shipping effect, prior research, song/patch formats and goldens unchanged.
It follows the [greenfield direction](2026-09-30-tape-greenfield-direction.md).

Compare the unchanged mapping, a mapping that clamps only the reversible
coefficient c to nonnegative, and that mapping with the specified odd C1
field knee. This is a declared experimental comparison, not a product
choice. Preserve Ms/a, the GPL core attribution, exact reconstructed H and
its derivative, RK stage timing, and playback. Apply the knee's chain
derivative at every stage. The original negative c endpoint is not by
itself evidence of instability.

The finite matrix and 15-minute sequential runtime bound were declared
before reproduction. Full evidence includes all signed failures and
unqualified cases; no reference margin, state guard or candidate target is
relaxed. Absolute boundary comparisons preserve DC and remanence, while
tones retain the existing unfitted dB/settling gates. Pure zero/tiny
boundary passes do not qualify a tone or establish overload recovery.

The amplitude knee alone does not establish a usable overload domain.
At controls 1/0/0, signed ±100 pulses fail RK4/16× at all three rates;
the surviving finer pair also fails the declared convergence criterion.
Even center ±1 pulses exceed the declared 1e-7 absolute reference margin.
Those unit-pulse errors decrease under refinement; this is an unmet
absolute precision target, not evidence of instability. The 1e-7/1e-5
reference/candidate limits are conservative diagnostic tolerances in
magnetization units, with a 100-fold reference margin. They are independent
of the legacy relative tone gates and are not audibility thresholds.
The complete numerical inventory and normal/corner qualification results
live in the experiment's README and report.

Amplitude bounding does not imply bounded slew: f'(0)=1 leaves large
reconstructed derivatives unchanged near zero crossings. That is a
mechanism to investigate, not proof that it is the sole cause of these
failures. Neither clamping c nor adding the knee is accepted as a general
stability solution.

The next bounded reference task must isolate center ±1 and controls
1/0/0 ±100 startup/return transients, beginning at 48 kHz and retaining
both polarities. Measure finer temporal refinement around reconstructed
zero/knee crossings and irreversible-branch changes; obtain two passing
successive raw/full comparisons against the unchanged absolute criterion
before extending that domain to dynamic qualification. Declare its finite
refinement plan and runtime bound first. If a derivative-consistent
bounded-slew field model is needed, declare that as a new system and
qualify its references independently. Do not silently clip dH or assume
control smoothing alone resolves the blocker.

Qualified tone rows are static comparison anchors for that next work,
not a qualified complete control/input domain. After the blocked static
references are resolved, B still requires rapid edits, signed overload
recovery, sustained DC/zero/tiny/extremes, opposite histories,
startup/recovery, zero-reset normal operation and 60-second runs at
44.1/48/96 kHz. Filter qualification, allocation-free implementation,
measured browser CPU, delay/bypass integration and the user's eventual
audition remain later milestones. B is not complete; nothing advances to
product integration on this result.

All corner references qualify, but later candidate/domain selection must
retain the waveform misses: per policy, RK4/2× passes 48/96 corner cases,
RK4/4× 90/96 and RK2/8× 84/96. In particular RK4/4× misses high tones at
controls 1/0/1, and RK2/8× at 1/0/1 and 1/1/1, at both polarities and all
rates. Solving boundary reference convergence does not solve these
candidate accuracy limits or choose a product solver.
