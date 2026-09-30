# Tape static conditioning seam

Windsor #167 is the first bounded part of milestone B in #146. This is
research only: no product solver, controls, defaults, modes or integration.
It imports #145's GPL-3.0-only CHOW-derived equation and #153's exact field,
RK stage integrator and playback unchanged. See the preserved
[AUDIT](../2026-09-30-tape-phase-3/AUDIT.md) and
[COPYING](../2026-09-30-tape-phase-3/COPYING).

## Declared experiment (before reproduction)

Compare unchanged control mapping with abort outside reconstructed |H|<=8;
the same mapping with c=max(0,c); and that mapping with an odd C1 knee.
The knee is identity for |H|<=1. Otherwise z=(|H|-1)/3 and
f(H)=sign(H)*(1+3*z/(1+z)), approaching magnitude 4. At every RK stage the
reconstructed derivative is multiplied by 1/(1+z)^2. Ms and a retain the
original formulas. Negative c at Width=1 is a mapping fact, not proof of
instability. Conditioning changes the defined system; differences from
the unchanged system are not integration error.

Controls are internal Drive/Width/Saturation in [0,1]: all eight corners
plus center 0.5/0.5/0.5. Invalid controls, rates and inputs are rejected.
No resets, failure-to-silence, clipping, fitted gain, DC removal or fitted
alignment is permitted. Raw magnetization and filtered output remain separate.

The complete finite matrix contains 801 groups and 4,806 requested
trajectories, before reuse of demonstrably identical policy trajectories:

| Domain | Matrix | Groups |
|---|---|---:|
| Center regression | Existing 72 normal signals × three policies | 216 |
| Corner tones | Eight corners × bins 17/1361 × amplitude 1 × both polarities × three rates × three policies | 288 |
| Independent center plateaus | Nine signed levels × three rates × three policies, zero history | 81 |
| Corner overload | Eight corners × levels ±100 × three rates × three policies, zero history | 144 |
| Opposite histories | Center × levels ±1/±100 × actual preconditioning ±1 × three rates × three policies | 72 |

Rates are 44.1/48/96 kHz. Center signals retain #153's 8192-frame periods,
bins 17/173/1361 or 997+1361, amplitudes 0.01/0.25/1, both polarities and
principal/extended settling windows (eight/sixteen periods for quiet low
tones, one/two otherwise). Plateaus are independent 512-frame trajectories:
levels 0, ±1e-12, ±1, ±8, ±100 on frames 128–255, returning to zero at 256.
Opposite histories use actual ±1 host pulses on frames 0–63 before the
common test plateau, with a zero gap. Every run begins at M=0; no reset
occurs inside a trajectory. First/last samples, pulse boundaries and
remanence are recorded; polarity is applied exactly once.
For boundary rows, `level` is the actual signed host plateau; the shared
driver's `amplitude: 1, sign: 1` is unity gain, not a second polarity label.
`inputPoints` records the signed host samples and reconstructed field.

Every group requests RK4 16×/32×/64× references and RK4/2×, RK4/4×,
RK2/8× candidates. Both successive raw and full unfitted reference
residuals must pass -70 dB low/mid or -60 dB high/two-tone, plus -80 dB
settling. Candidates require qualified raw and full references and full-output
targets -60/-50 dB, plus <=0.1 dB extended-window sensitivity; raw candidate
residuals are diagnostic. These are
distinct flags from finite state. Boundary comparisons use maximum absolute
raw/output difference <=1e-7 for both reference pairs and <=1e-5 for
candidates across the entire trajectory. This absolute criterion never
qualifies tones, and does not assert long-duration DC stability.

The absolute units are the equation's raw magnetization units, carried
unchanged through the playback filter (no makeup gain). The 1e-7 reference
and 1e-5 candidate limits are predeclared conservative diagnostic precision
targets, with a 100-fold margin between them. They permit comparison when
DC/zero histories have a vanishing relative denominator; they are not
derived from the tone dB gates or an audibility threshold. A finite unit
pulse can show decreasing refinement errors yet miss this stricter
absolute target. Zero/tiny passes do not establish relative accuracy at
1e-12, much less qualify a tone or overload response.

Center RK4/4× is independently rendered through the read-only #153 driver
for each signal/rate. Identity policies must match raw/full output exactly;
any nonidentity result is labeled a system change. Exact reconstruction
is cached on the 128-stage-per-host grid and integer subgrids select its
exact evaluations. No interpolated derivative or playback optimization is
introduced. Policies reuse trajectories only when c is identical and,
for the knee, every original stage remains in the identity region.

One sequential numerical child has a hard **15-minute** budget. It visits
plateaus, corner tones, then center regressions; no failure is dropped.
Completed trajectories are journaled immediately; the final report retains
partial groups, all missing case identities, and an explicit incomplete
status if interrupted. Missing refinement never qualifies a candidate.
Settings keep conditioning, stimuli, reference and filter namespaces separate.

## Reproduce

From repository root on Node 24:

```sh
node docs/research/2026-09-30-tape-conditioning/measure.mjs
npx vitest run scripts/lib/tapeConditioning.test.mjs scripts/lib/tapeFilteredReference.test.mjs --no-cache
npm run typecheck
npx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --strict --skipLibCheck docs/research/2026-09-30-tape-conditioning/*.ts
npm run lint
npx prettier --check --ignore-path /dev/null 'docs/research/2026-09-30-tape-conditioning/*.{ts,mjs}' scripts/lib/tapeConditioning.test.mjs
git diff --check
```

## Results and remaining blockers

The final reproduction completed **801/801 groups in 557.598 seconds**,
inside the 900-second budget, with no missing or partial records. All 4,806
requested trajectories have state/failure evidence; exact-policy reuse is
identified in each state record. These are numerical results on Apple M1
arm64, Darwin 25.5.0, Node 24.20.0 / V8 13.6.233.17-node.53, Float64 source
DSP, no browser/audio device. Runtime is a reproduction bound, not a
real-time CPU measurement.

The following counts hold **separately for each of the three policies**.
Equal counts do not mean equal waveforms or equal failure mechanisms.

| Domain (groups per policy) | Raw/full reference passes | RK4/2× | RK4/4× | RK2/8× |
|---|---:|---:|---:|---:|
| Normal center (72) | 72 / 72 | 72 | 72 | 72 |
| Corner tones (96) | 96 / 96 | 48 | 90 | 84 |
| Signed boundaries/histories (99) | 9 / 9 | 9 | 9 | 9 |

The normal center regression reproduces #153 wherever the policy is
identity: all 72 unchanged, 72 nonnegative and 54 identity-knee RK4/4×
renders match exactly, raw and full, including startup. The other 18 knee
rows are amplitude-1 low/high/two-tone cases; their largest full-trajectory output
change is 0.000169586. This is a change to the defined conditioned system,
not solver error. Worst normal full candidate residuals are -51.19 dB,
-69.64 dB and -53.76 dB for RK4/2×, RK4/4× and RK2/8× respectively.

All corner references qualify, but no candidate passes the entire corner
domain. At every rate and both polarities, RK4/2× misses the high-bin target
at all eight corners. RK4/4× misses it at controls **1/0/1** (Drive/Width/
Saturation), and RK2/8× misses at **1/0/1 and 1/1/1**. For 48 kHz, bin 1361,
amplitude 1, controls 1/0/1, full residuals are -31.18 dB for RK4/4× and
-41.49 dB for RK2/8×, against the -50 dB target. These candidate/domain
misses remain on the later solver/control-domain selection list; the
immediate boundary-reference task does not resolve them.

Only zero and ±1e-12 center boundary groups meet the declared absolute
reference criterion. All nonzero unit pulses are finite with decreasing
refinement errors, but miss that conservative precision target. For the
48 kHz center knee +1 or -1 zero-history pulse, full maximum differences
shrink from 2.578e-5 to 3.538e-6; raw differences shrink from 2.791e-5 to
3.489e-6. This is not evidence of instability. Every other boundary row
remains unqualified; no failed refinement is removed.

Large-overload results are materially different. Counts below are
trajectories, counting each reference integration once (raw/full observe
the same trajectory); each policy requests 297 boundary reference and
297 boundary candidate trajectories.

| Policy | Reference domain aborts | Reference state failures | Candidate domain aborts | Candidate state failures |
|---|---:|---:|---:|---:|
| Unchanged | 216 | 0 | 204 | 12 |
| Nonnegative c | 216 | 0 | 204 | 12 |
| Nonnegative c + knee | 0 | 6 | 0 | 84 |

The six knee reference state failures are exactly **controls 1/0/0,
zero-history ±100, RK4/16×, at all three rates**. They occur at integration
index 4369 (host time 273.0625), in the return transient after the plateau
ends at 256. The largest conditioned field seen is only 3.92153, yet the
state guard aborts. The surviving 32×→64× pair at 48 kHz still differs by
1.06012 raw and 1.16546 full. Center ±100 knee pulses remain finite at the
reference factors but disagree by 0.36219→0.15323 raw and
0.48040→0.13777 full. All invalid residuals remain null; no reset or
silence receives a passing flag.

Opposite histories are distinct physical trajectories in this model:
at 48 kHz center knee, the ±1 preconditioning pulses leave raw M at
frame 127 of ±0.0534122 before the common +1 plateau. Its final zero-input
remanences differ (0.0533223 versus 0.0535105). These values remain in the
report, without DC removal. They do not establish recovery or a listening
result.

**Next bounded action:** isolate the center ±1 and controls 1/0/0 ±100
startup/return transients, beginning at 48 kHz and both polarities; refine
the temporal reference around field zero/knee and irreversible-branch
crossings with a predeclared budget until two successive raw/full pairs
meet the unchanged absolute criterion. Amplitude bounding is not a slew
bound: f'(0)=1 leaves large derivatives near zero unchanged. Investigate
that mechanism without assuming it is the sole cause. If a continuous
bounded-slew field is needed, declare and independently qualify that new
system with its matching derivative. Carry qualified tone rows as
comparison anchors; no full control/overload domain is ready for dynamic
qualification yet. See the
[decision](../../log/2026-09-30-tape-static-conditioning.md).

Validation also confirms all matrix controls are finite numbers in [0,1].
An input-type rejection guard added during the final run changes none of
those valid trajectories; its null/invalid-control tests pass. The
interrupted preliminary run's 639 shared groups and the final run have
identical numerical residuals and candidate flags. The final run includes
corrected conditioning-region counts/identity metadata near the knee and
explicit raw/full boundary gate enforcement; every saved boundary flag
was independently recomputed from its residuals. The waveform equation
and predeclared thresholds were unchanged.

This task does not complete B. Dynamic smoothing, rapid edits, signed
overload recovery, sustained DC/zero/tiny/extremes, opposite histories,
startup/recovery and 60-second runs at every rate remain required next.
Filter qualification, allocation-free implementation, browser CPU and
latency/bypass integration follow. No CPU, listening or product claim.
