# Bound Tape's corner-tone accuracy for RK4 2× and 4× with both FIR pairs

Windsor [#215](https://github.com/tacowars/windsor/issues/215) closes
milestone B's last accuracy question in
[epic #146](https://github.com/tacowars/windsor/issues/146). It follows
[static conditioning](2026-09-30-tape-static-conditioning.md),
[the filtered reference](2026-09-30-tape-filtered-reference.md),
[the resampler](2026-09-30-tape-resampler.md) and the
[greenfield direction](2026-09-30-tape-greenfield-direction.md). The pending
milestone D record (`2026-09-30-tape-magnetic-integration-design`) fixes the
product core: RK4, 2× by default with 4× as an audition switch, behind the
span-48 pair, on the `knee` system. Earlier corner numbers used only the
span-32 pair at the control endpoints. This task measures the two product
settings, and the same factors with the span-32 pair, at every control
point.

## Decision

- **Matrix.** Declared before reproduction: 48 kHz; the eight corners and
  the centre; bins 17, 173 and 1361 and the 997+1361 two-tone; levels 0.25
  and 1 (gated) and 4 (the domain edge, ungated). That is 108 reference
  cases and 432 candidate renders.
- **Reference.** #167's qualified continuous span-32 reference, with RK4 at
  16/32/64×, both successive pairs raw and full, margins of -70/-60 dB and
  the -80 dB settling gate. An unqualified reference marks its candidates
  `no reference`.
- **Candidates.** RK4 at 2× and 4×, each with the span-32 pair (existing
  decimator) and the span-48 pair (symmetric decimator).
  - The stages read the pair's continuous interpolating function and its
    exact derivative, as in #167.
  - The unchanged decimator classes filter the states.
  - `render.ts` generalises the continuous kernel and field to take the
    span, because the imported ones fix it at 32. At span 32 it is
    bit-identical to them.
- **Gate.** Unchanged: at most -60 dB low/mid and -50 dB high/two-tone,
  unfitted, aligning only the `span`-sample pair delay against the
  reference's 32. Gain/phase projection, other-bin energy and the level-4
  rows are reported beside it, ungated.
- **Bound.** One child under a 900-second SIGKILL, journaled case by case.

## Outcome

The [report](../research/2026-09-30-tape-corner-accuracy/README.md) has the
full results. The run completed 108/108 references and 432/432 candidates in
188.7 s on an Apple M1, Node 24.21.0, with the Float64 source DSP.

- **References.** 106/108 qualify, including all 72 gated cases. The two
  that do not are at the domain edge: controls 1/0/1, level 4, bin 1361 and
  two-tone.
- **Per setting, over 72 gated rows:**
  - RK4/2× span 32 passes 46;
  - **RK4/2× span 48 passes 44**;
  - RK4/4× span 32 passes 66;
  - **RK4/4× span 48 passes 50**.

  Every low and mid row passes everywhere. Every failure is a high or
  two-tone row. The worst row in every setting is controls 1/0/1, bin 1361,
  level 1: -14.8 dB at 2× and -30.6 to -31.2 dB at 4×, against -50 dB.
- **Span 48 against span 32.** It changes the verdict from pass to fail on
  2 rows at 2× and 16 rows at 4×. The recorded spectra place the change in
  the filter:
  - carriers agree within 0.0007 dB and 1.6e-5 rad, and aliasing within
    0.022 dB;
  - span 48 removes the third harmonic of bin 1361 (0.498 fs) by 24.37 dB,
    and the span-32 reference keeps it.

  The residual against a span-32 reference therefore includes the pair's
  own response. No span-48 reference was in the declared matrix, so this
  run does not separate the two further.
- **Plain statement.** **Neither product setting meets the gates at every
  control point.**
  - RK4/2× with span 48 fails 28 rows, and RK4/4× with span 48 fails 22.
  - The worst is 1/0/1, bin 1361, level 1: 35.2 and 19.4 dB past the gate.
  - The remaining 4×/48 misses lie between -40.3 and -48.4 dB.
  - With the span-32 pair, RK4/4× misses only six rows: 1/0/1 at level 1,
    and the two-tone case at 0/1/x and 1/1/x at level 0.25.

**The default is not chosen here.** These numbers inform tacowars's
audition of 2× against 4×. They do not reopen the milestone D decisions and
do not relax any gate.

## Still unresolved

- Accuracy at 44.1 and 96 kHz.
- A span-48 reference that would separate the pair's response from
  integration error.
- Milestones D and E.
