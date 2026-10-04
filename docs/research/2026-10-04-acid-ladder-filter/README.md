# The Acid Ladder: a TB-303 diode ladder model for the voice filter, planned

A seventh voice filter mode is proposed: a four-stage diode ladder lowpass
after the Roland TB-303, beside the state-variable filter, which keeps its
Lowpass, Highpass, Bandpass, Notch and Formant modes untouched. This folder
holds the modelling work behind the plan: the circuit equations the model is
built from, their check against the published transfer function, the
numbers that follow from them (pole spread, slope, the self-oscillation
threshold, what the feedback high-pass does), a prototype of the
discretisation and a matrix of how hard its solver has to work. The
decisions are in `docs/log/2026-10-04-acid-ladder-filter-mode.md`. Nothing
here is shipping code; `model.mjs` reproduces every table below
(`node model.mjs`, and `node model.mjs --matrix` for the solver matrix,
Node 24; the matrix's full output is `solver-matrix.txt`). These are
computed values, not performance readings: no CPU cost is claimed here, and
the cost of the shipped filter is a measurement the engine ticket makes on
the bundle. The engine ticket (windsor#573) made it: its readings of the
shipped bundle, both solver candidates, the saturator, the cost, the
aliasing and the convergence, are the section "The shipped filter"; the
sound-design pass (windsor#574), the output mix (windsor#577) and the
makeup (windsor#587) follow it.

Codex reviewed the first version of this folder (`codex-review.md`,
`review-check.mjs`, which identifies the prototype it reviewed by hash and
refuses the current one). Its two P1 findings were confirmed and are fixed
below; its two P2 findings corrected a source reading and a release
premise. The section at the end lists each finding and what changed.

## Sources

- T. E. Stinchcombe, *Analysis of the Moog transistor ladder and derivative
  filters* (`windsor-corpus/303-filter/Moog_ladder_tf.pdf`): the stage
  equations (23), (24), (27), the general diode ladder transfer function
  (30), the TB-303 configuration ("a single diode and the bottom capacitor
  half the others") and its normalised polynomial, the pole discussion in
  §3.5 and the remark on the "18 dB" description.
- Roland, *TB-303 Service Notes* (1982), page 5, the main board schematic
  (the manualslib page the brief links is this document): the ladder is
  C18 at 0.018 µF at the bottom under C19, C24 and C26 at 0.033 µF, so the
  bottom capacitor is 0.545 of the others; the resonance return from the
  top of the ladder passes two coupling stages (C25/C27 at 0.1 µF, then
  C13/C15 at 1 µF) into the resonance pot VR4 (50 kΩ, B) and R46 (47 kΩ)
  on its way back to the input pair. That return is a higher-order
  high-pass with several resistances in it, and this note does not reduce
  it to a corner.
- timothy.place, *acid* and *machine/diode* (TapTools): the same circuit
  modelled; the feedback high-pass is "a ~150 Hz one-pole high-pass
  (Open303's calibrated value)", so 150 Hz is a calibration of the whole
  return to one pole, not a component value; "stock 303s never quite
  self-oscillate"; the stability boundary at exactly k = 17 "with the
  marginal oscillation at √2 × the stage rate"; a stock cutoff range of
  302–2394 Hz; a secant-gain solver (γ = tanh(e) / e) solved in closed form
  bottom-up, with an iterated "exact" variant.
- Csound's `diode_ladder` (Pirkle's ZDF diode ladder after Zavalishin):
  resonance 0–17, self-oscillation at 17. That value is derived below from
  the TB-303 capacitor ratio, which places Pirkle's ladder in the same
  configuration.
- Real World Interfaces, Devil Fish: the stock filter is not switched to
  self-resonance; the modification adds it, with a wider cutoff range.

## The model

### The circuit as four coupled capacitors

Stinchcombe's ladder is four capacitors C₁..C₄ between the two rails,
joined by diode pairs (in the TB-303, transistors wired as diodes), with the
input differential pair injecting at the bottom and the output pair closing
the top. Writing the differential voltage across capacitor n as xₙ (in units
of 2V_T) and the currents in units of the ladder current I_f, his equations
say:

- a diode pair between stages n and n + 1 passes the differential current
  `tanh(xₙ₊₁ − xₙ)` (equation (9), linearised to `(xₙ₊₁ − xₙ) / a` in (24));
- the input pair passes `tanh(u)` for the input voltage u ((26) and the
  line above it);
- the output pair passes `−tanh(x₄)` (equation (27), "the subtle sign
  change");
- each capacitor integrates the difference of the currents above and below
  it ((23): `ΔIₙ = ΔIₙ₊₁ − 2sCₙΔVₙ`).

With τ = 2aC (C the common capacitor, a = 2V_T / I_f) and cₙ = Cₙ / C:

```
c₁ τ ẋ₁ = tanh(x₂ − x₁) − tanh(u)
   τ ẋ₂ = tanh(x₃ − x₂) − tanh(x₂ − x₁)
   τ ẋ₃ = tanh(x₄ − x₃) − tanh(x₃ − x₂)
   τ ẋ₄ = −tanh(x₄)     − tanh(x₄ − x₃)
   y = x₄,   u = in + k · hp(y)
```

Every capacitor is driven by both its neighbours: that is the loading the
ticket asks for, and it is why the ladder is not four isolated one-poles.
The resonance is the TB-303's: the output fed back into the input pair,
through a high-pass standing for the return's coupling stages, where the
pair's `tanh` saturates input and feedback together. The output's sign is
the ladder's inversion (G has a −1 numerator); the plan's filter negates it
so the mode has the Lowpass mode's polarity.

### Check against the published transfer function

Linearising the chain (every `tanh(v)` → `v`) gives a 4 × 4 state matrix
whose characteristic polynomial is computed in `model.mjs`
(Faddeev–LeVerrier). In τ = 1 units, with c₁ = ½:

```
s⁴ + 8 s³ + 20 s² + 16 s + 2
```

which is twice Stinchcombe's unnormalised denominator
`8a⁴C⁴s⁴ + 32a³C³s³ + 40a²C²s² + 16aCs + 1` (a⁴C⁴ = τ⁴/16, and so on).
Normalising to his ω_c = 2^¼ / τ:

| | s⁴ | s³ | s² | s | 1 |
|---|---|---|---|---|---|
| the chain, c₁ = ½ | 1 | 6.7272 | 14.1421 | 9.5137 | 1 |
| Stinchcombe, G_tb | 1 | 6.727 | 14.142 | 9.514 | 1 |
| the chain, c₁ = 1 | 1 | 7 | 15 | 10 | 1 |
| Stinchcombe, G₁ | 1 | 7 | 15 | 10 | 1 |
| the chain, c₁ = 18/33 (the schematic's values) | 1 | 6.7319 | 14.1555 | 9.5205 | 1 |

The chain is his circuit. The schematic's 0.018 / 0.033 ratio (0.545
rather than ½) moves the normalised coefficients by under 0.1 % and the
poles by under 0.2 %, so the plan uses the published half and its tests
compare to the published polynomial.

### What the pole spread does

Poles of G_tb at k = 0, in units of ω_c: **−0.128, −1.038, −2.325,
−3.236** (G₁'s are −0.121, −1.000, −2.347, −3.532, as §3.5 lists). Real
and spread over five octaves, where the Moog's four sit together at −1.

| octave band, in ω_c | G_tb slope, dB/oct | Moog (1 + s)⁴ |
|---|---|---|
| ⅛ – ¼ | −4.2 | |
| ¼ – ½ | −6.2 | |
| ½ – 1 | −8.6 | −8.2 |
| 1 – 2 | −12.5 | −15.9 |
| 2 – 4 | **−17.5** | −21.3 |
| 4 – 8 | −21.4 | −23.3 |
| 8 – 16 | −23.3 | |
| 16 – 32 | −23.9 | |

The −3 dB point at k = 0 sits at **0.126 ω_c**, three octaves below ω_c,
and |G_tb(jω_c)| is −21.9 dB. The slope passes through about 18 dB/oct in
the two octaves above ω_c, where the Moog is already past 21, and both
reach 24 further out: Stinchcombe's "a gentler slope it may be, but calling
it a '3-pole, 18dB/octave' is at best misleading". A generic three-pole
filter has none of this spread.

### Resonance: feedback k, the self-oscillation threshold, and the high-pass

With feedback k the poles are the roots of D(s) + k. The Routh condition
on `s⁴ + 6.727 s³ + 14.142 s² + 9.514 s + (1 + k)` gives self-oscillation
at **k = 17.00** (17.02 with the schematic's ratio): Csound's and Pirkle's
17, derived, and TapTools' "exactly k = 17". The marginal oscillation sits
at 1.189 ω_c, which is 2^¼ ω_c = √2 / τ, their "√2 × the stage rate".

| k | DC gain | peak | peak at | ζ of the dominant pair | Q = 1 / 2ζ |
|---|---|---|---|---|---|
| 0 | 0 dB | — | — | real poles | — |
| 1 | −6.0 dB | — | — | real | — |
| 2 | −9.5 dB | — | — | 0.731 | 0.7 |
| 4 | −14.0 dB | −12.4 dB | 0.53 ω_c | 0.459 | 1.1 |
| 8 | −19.1 dB | −12.1 dB | 0.86 ω_c | 0.215 | 2.3 |
| 12 | −22.3 dB | −8.3 dB | 1.04 ω_c | 0.093 | 5.4 |
| 14 | −23.5 dB | −4.3 dB | 1.11 ω_c | 0.050 | 9.9 |
| 15 | −24.1 dB | −0.9 dB | 1.14 ω_c | 0.032 | 15.6 |
| 16 | −24.6 dB | +4.9 dB | 1.16 ω_c | 0.015 | 32.6 |
| 16.5 | −24.9 dB | +10.9 dB | 1.18 ω_c | 0.0075 | 67 |
| 17 | −25.1 dB | ∞ | 1.19 ω_c | 0 | ∞ |

The passband falls as 1 / (1 + k), the ladder's well-known loss of bass
with resonance, and the peak sits a little above ω_c, as §3.5 says
("the peaks tend to come to a point at a value of ω just above 1").

A one-pole high-pass in the feedback path (`s / (s + ω_hp)`, ω_hp at
150 Hz, the calibrated image of the hardware's return) changes both ends.
At DC it removes the feedback, so the bass comes back; near the peak its
phase lead damps the resonance, more the lower the cutoff:

| cutoff f_c | k at self-oscillation with the high-pass | peak at k = 16 (no high-pass: +4.9 dB) |
|---|---|---|
| 5 kHz | 17.6 | +0.8 dB |
| 2 kHz | 18.6 | −3.2 dB |
| 1 kHz | 20.2 | below the low end |
| 500 Hz | 23.7 | below the low end |
| 300 Hz | 28.8 | |
| 200 Hz | 35.7 | |
| 100 Hz | > 60 | |

So one fixed feedback ceiling just under 17 is "very close to
self-oscillation" at the top of the stock cutoff range and progressively
less resonant below it, with no oscillation anywhere: the stock TB-303 as
the brief and the references describe it. These rows are the one-pole
model's: they show what the plan's filter will do, and they stand or fall
with the 150 Hz calibration, which is a tunable
(`LADDER_FEEDBACK_HP_HZ`) tacowars sets by ear and a later circuit
reduction of the schematic's return could replace. The plan's
`LADDER_FEEDBACK_MAX` is 16.5 to start, likewise by ear; an extended mode
would raise it past 17.

### The discretisation

`model.mjs` runs the nonlinear chain with the trapezoidal rule in
integrator-memory form, the TPT form the SVF and the noise colour use:
each state keeps `s = x + h·f`, so `x⁺ = s + h·f(x⁺)` and then
`s ← 2x⁺ − s`, the SVF's `ic = 2v − ic`. The previous endpoint's
derivative therefore lives in the state, and the input is read once, at
the new endpoint. (The first prototype evaluated that derivative again
with the current input, which is not the trapezoidal rule: it multiplied
the input by `2 / (1 + z⁻¹)`, 1 / cos(πf / f_s), 8.3 dB at an 18 kHz
cutoff. Codex's finding 1; see the review section.) The cutoff is
prewarped; the high-pass is a TPT one-pole on x₄ whose output at the new
endpoint enters the input pair's `tanh`, so the feedback's saturation is
the pair's; each sample is solved by a fixed number of Newton steps on the
four states, starting from `s`.

At 48 kHz, a 10⁻⁴ sine, digital / analog in dB, the analog response read
at the digital frequency's bilinear image so the warp is not counted as
error (the design puts the digital cutoff exactly on ω_c):

| f_c, k | ⅛ ω_c | ¼ | ½ | 0.8 | 1 | 1.1 | 1.25 | 2 | 4 |
|---|---|---|---|---|---|---|---|---|---|
| 500 Hz, 0 | −3.01 / −2.99 | −7.14 / −7.14 | −13.31 / −13.31 | −18.79 / −18.79 | −21.91 / −21.91 | −23.36 / −23.36 | −25.44 / −25.44 | −34.46 / −34.46 | −52.06 / −52.06 |
| 500 Hz, 16 | −17.58 / −17.55 | −21.69 / −21.69 | −23.16 / −23.16 | −21.13 / −21.13 | −17.64 / −17.64 | −14.93 / −14.93 | −12.58 / −12.58 | −32.14 / −32.14 | −52.07 / −52.07 |
| 2 kHz, 16 | −23.52 / −23.52 | −24.21 / −24.21 | −23.29 / −23.29 | −20.00 / −20.00 | −14.77 / −14.77 | −9.11 / −9.11 | −9.10 / −9.10 | −32.90 / −32.90 | −54.61 / −54.61 |
| 200 Hz, 16 | −11.95 / −11.95 | −17.24 / −17.24 | −21.26 / −21.26 | −21.71 / −21.71 | −20.54 / −20.54 | −19.74 / −19.74 | −19.10 / −19.10 | −31.84 / −31.84 | −51.90 / −51.90 |
| 10 kHz, 0 | −2.36 / −2.36 | −6.06 / −6.06 | −12.08 / −12.08 | −18.00 / −18.00 | −21.91 / −21.91 | −23.97 / −23.97 | −27.29 / −27.29 | −57.64 / −57.64 | |
| 18 kHz, 0 | −0.92 / −0.92 | −3.01 / −3.01 | −7.93 / −7.93 | −14.72 / −14.72 | −21.91 / −21.91 | −28.27 / −28.27 | | | |
| 18 kHz, 16 | −24.59 / −24.59 | −24.53 / −24.53 | −24.16 / −24.16 | −22.43 / −22.43 | −13.62 / −13.62 | −21.19 / −21.19 | | | |

Within 0.03 dB everywhere, including the two cutoffs the review tested,
and −21.91 dB at the cutoff itself at every f_c (the analog value, which
the first prototype missed by 8.3 dB at 18 kHz). The engine's direct test
compares the shipped filter's small-signal magnitude and phase to the
same analog expression the same way, at these cutoffs and feedback
values.

Large signal, f_c 1 kHz, k 12, a 110 Hz sine, with the input in the
model's 2V_T units:

| input amplitude | RMS gain | H3 | H5 |
|---|---|---|---|
| 0.05 | 0.119 | −120 dB | — |
| 0.5 | 0.119 | −79 dB | −136 dB |
| 1 | 0.119 | −67 dB | −111 dB |
| 2 | 0.118 | −55 dB | −87 dB |
| 4 | 0.117 | −41 dB | −59 dB |

Odd harmonics only, from the stages and the input pair together, and the
gain at 110 Hz is 0.12 rather than the 1 / 13 the feedback alone would
give, because the high-pass passes only 59 % of the feedback at 110 Hz.
How hot the voice drives the ladder (`LADDER_INPUT_SCALE`, the carrier
sum's unit mapped to this amplitude) is a sound-design value for tacowars's
ear; the voice's Drive stage sits before the filter, with a gain of up to
64, so the ladder must stay well-behaved at any level.

### The solver: how many Newton steps

Codex's finding 2 (two Newton steps fail on a band-limited saw at an
18 kHz cutoff) led to a matrix instead of a single reading: a 110 Hz
band-limited saw and square (harmonics through 127) at peak 2 and peak 8,
cutoffs 500 Hz to 18 kHz, k 0, 8 and 16.5, at 1× and at 2× (two sub-steps
on a linearly interpolated input, the last one taken; no decimation
filter, since this measures the solver, not aliasing). Each Newton count's
peak-relative maximum error against 24 steps, in dBr, over the second
quarter second. The worst cell at each cutoff over k, waveform and level:

| cutoff | 1×, 2 steps | 1×, 3 steps | 1×, 4 steps | 2×, 2 steps | 2×, 3 steps | 2×, 4 steps |
|---|---|---|---|---|---|---|
| 500 Hz | −190 | −298 | −298 | −226 | −296 | −298 |
| 2 kHz | −123 | −246 | −297 | −158 | −294 | −294 |
| 5 kHz | −80 | −143 | −270 | −112 | −218 | −293 |
| 10 kHz | −38 | −80 | −148 | −80 | −143 | −269 |
| 18 kHz, peak 2 | −34 | −38 | −77 | −83 | −150 | −271 |
| 18 kHz, peak 8 | no convergence at any count | | | −49 | −94 | −170 |

The step h = tan(πf_c / f_s) / 2^¼ is 0.11 at 2 kHz, 0.65 at 10 kHz and
2.03 at 18 kHz; past 1 the saturating stages move almost fully in one
sample and Newton from the previous state stops converging, and at
18 kHz with a hot input it does not converge at all (8 steps and 24 steps
differ at 0 dBr). Where the instrument lives, up to 5 kHz, two steps hold
−80 dBr at 1×. The cutoff knob reaches 18 kHz, so the shipped solver must
be right there too. Two candidates meet that, and the engine ticket
measures their cost and aliasing and picks one:

- **2× with three steps**: −94 dBr at the worst cell, −143 or better up to
  10 kHz; six solves a sample plus the up- and down-sampling, which also
  halves the aliasing question. The voice has no oversampling today; the
  tape and Advanced Drive inserts carry windowed-sinc 2× pairs
  (`worklet/tape/tapeOversample.ts`, `worklet/advancedDrive/driveOversample.ts`),
  and a ladder, being a 24 dB/oct lowpass itself, may need a far shorter
  decimator, which the aliasing reading decides.
- **1× with four steps and the ladder's ω_c capped at 10 kHz**: −148 dBr
  at the worst cell within the cap; four solves a sample, no resampling.
  The Acid mode's Cutoff then stops opening at 10 kHz (where the ladder's
  zero-resonance −3 dB point is 1.3 kHz), a visible difference from the
  other modes that the record would state.

Both hold the count fixed, so the cost is the same every sample and the
goldens are deterministic. Whichever is chosen, the test adds the
matrix's worst cells (18 kHz or the cap, k 16.5, both waves at peak 8)
and a full-scale noise burst at the ceiling, and holds the output finite
and bounded there.

## What the engine ticket measures

1. **Response.** The shipped filter's small-signal magnitude and phase
   against the analog expression at the bilinear image, as above, at
   500 Hz, 2 kHz, 10 kHz and the top of the range, k 0, 8 and 16, through
   the shipped bundle and the harness.
2. **Cost.** The Formant bench (`../2026-10-02-formant-filter/bench.mjs`)
   with the two solver candidates as variants: each one's own ns per
   voice-sample, and that Off, LP, BP, the 24 dB pair and Formant cost what
   they did with an Acid voice in the bundle (the Formant work found three
   more inlined `Svf.process` sites slowed every mode by 25 %; the ladder
   is one call through a field, like `VoiceDrive.curve`, and the bench is
   the check). Machine, Node and bundle named.
3. **Aliasing.** Across the usable cutoff range, 500 Hz to the top, at
   k 16.5 and the ceiling input, a sine sweep: the aliased products' level
   for each candidate. Not one cutoff.
4. **Convergence.** The chosen count against a converged run on the
   matrix's worst cells, through the shipped saturator and its derivative.

## Codex's review: findings and what changed

1. **P1, the discretisation was not trapezoidal** (`model.mjs`, the `f0`
   evaluation). Confirmed: `review-check.mjs` reproduced the 8.34 dB excess
   at an 18 kHz cutoff, and the `2 / (1 + z⁻¹)` explanation is exact. The
   prototype was rewritten in integrator-memory form (above), which is the
   form the engine's filters already take; every response table was
   recomputed and now agrees with the analog expression at the bilinear
   image within 0.03 dB up to 18 kHz. The direct test in the plan now
   compares magnitude and phase at high cutoffs and nonzero feedback.
2. **P1, two Newton steps are not enough across the range.** Confirmed:
   the matrix reproduces the failure (−34 dBr at 18 kHz with peak 2; no
   convergence at peak 8, which the review did not reach) and shows two
   steps holding −80 dBr only up to 5 kHz at 1×. Decision 6 in the record
   is reopened: the count is not two, and the solver is one of the two
   candidates above, chosen on measured cost and aliasing, with the
   worst cells and a finiteness check in the tests.
3. **P2, the 150 Hz high-pass was wrongly derived from components.**
   Confirmed from the service notes' schematic: the 10 nF / 100 kΩ pair I
   quoted sits around the VCA, and the resonance return passes 0.1 µF and
   1 µF coupling stages into the 50 kΩ pot. 150 Hz is Open303's calibrated
   one-pole image of that return (TapTools says so), and the sources and
   the record now say so; it is a tunable, and the thresholds and
   thinning rows above are labelled as the one-pole model's. A circuit
   reduction of the return is noted as later work, not assumed.
4. **P2, the engine ticket exposes the mode in the console.** Confirmed:
   `buildFilter` lists `FILTER_MODE_NAMES` in its mode segment, so `Acid`
   is selectable the moment the engine lands. tacowars does not mind, and
   the record's release premise is corrected: the engine ticket also owns
   the console's one-line `filterModeShows` change, so the mode arrives
   whole, and the listen is the sound-design ticket's as before.

The review also asked that the aliasing check cover the usable range
rather than one cutoff, which the list above now does.

## The shipped filter (windsor#573)

The engine ticket built both solver candidates into `worklet/fm/ladder.ts`
(the count, the oversampling and the cap are `fmConstants.ts`'s, and a
ladder's `steps` and `oversample` fields), read them on the shipped bundle,
and ships **1× with four Newton steps and the cutoff held to 10 kHz**. The
scripts here load `packages/engine/src/worklet/generated/fm-processor.js`
from a root (`bundle.mjs`, which also tunes a ladder onto either candidate
directly, without the cap, with `Math.tan`), so each runs on any build:

```
node saturator.mjs                     # the diode law's order
node response.mjs <repo>               # small-signal response, both candidates
node convergence.mjs <repo>            # Newton count against 24 steps
node aliasing.mjs <repo> [--level 4]   # a sine sweep's aliased products
node ladderBench.mjs <repo>            # the ladder alone, ns a sample
node bench.mjs <repo> <before root> [--acid 0]   # the voice, every mode
```

Every reading below is from an Apple M1 (8 cores) under Node 24.21.0, the
branch's bundle at the engine commit against `origin/main`'s at `2bc246b`
for "before", with other sessions running on the machine (load average
2.5 to 2.9), so each bench was run more than once and the runs are given.

### The diode law

A truncation of Lambert's continued fraction for tanh,
x P(x²) / Q(x²), held at ±1 from the first |x| where it reaches 1
(`saturator.mjs`; the cost is a tight loop of value and slope, relative
only):

| order | limit | max \|R − tanh\| | max \|R′ − tanh′\| | slope at the limit | ns |
|---|---|---|---|---|---|
| 3/2 | 2.32 | 1.9e-2 | 3.8e-2 | 7.0e-2 | 1.7 |
| 5/4 | 3.65 | 1.4e-3 | 2.7e-3 | 4.9e-3 | 2.3 |
| **7/6** | 4.97 | **9.6e-5** | 1.9e-4 | 3.5e-4 | **3.5** |
| 9/8 | 6.30 | 6.8e-6 | 1.4e-5 | 2.5e-5 | 7.7 |

All four are monotone. 7/6 ships (`ladderTables.ts`): within 1e-4 of
`Math.tanh` (−80 dB), at half the cost of the next order. Its Jacobian is
its own derivative, so Newton converges to the rational's solution.

### Response (reading 1)

`response.mjs`, a sine of 1e-4 against 1 / (D(s) + k HP(s)) at the
bilinear image of each candidate's own step rate, 100 Hz to 2 f_c, k 0, 8
and 16, the largest gap:

| cutoff | 1× four steps | 2× three steps |
|---|---|---|
| 500 Hz | 0.000 dB, 0.00° | 0.019 dB, 3.75° |
| 2 kHz | 0.000 dB, 0.00° | 0.299 dB, 15.0° |
| 10 kHz | 0.000 dB, 0.00° | 7.5 dB, 77° |
| 18 kHz | (plays 10 kHz) 0.000 dB, 0.00° | 12.6 dB, 99° |

The 1× solver is the bilinear transform of the analog ladder, so it meets
it to the reading's own precision; `ladder.test.ts` holds it within 0.01 dB
and 0.1° at 500 Hz, 2 kHz, 10 kHz and the top, and
`synth/fmProcessorFilterLadder.test.ts` within 0.5 dB and 5° through the
voice with white noise, bin by bin from 100 Hz to 2 f_c. The 2× candidate's
linear interpolation and its decimator's delay and droop are what it is off
by; it would not meet the acceptance's 0.5 dB and 5° above a few hundred
hertz without a longer, linear-phase resampling pair, which costs more.

### Convergence (reading 4)

`convergence.mjs`, each candidate's count against 24 steps of the same
solver through the shipped saturator and decimator, the research matrix's
inputs (saw and square at peak 2 and 8, k 0, 8 and 16.5), the worst cell
at each cutoff, dBr:

| cutoff | 1× four steps, 48 kHz | 1× four steps, 44.1 kHz | 2× three steps |
|---|---|---|---|
| 500 Hz | −298 | −298 | −296 |
| 2 kHz | −295 | −296 | −292 |
| 5 kHz | −270 | −255 | −218 |
| 10 kHz | −148 | −117 | −143 |
| 18 kHz | (plays 10 kHz) −148 | (plays 10 kHz) −117 | −95 |

The worst cell is always k 16.5, the square at peak 8. Both are far inside
the acceptance's −60 dBr; at 44.1 kHz the cap's step is longest
(h = 0.73), and four steps still hold −117. `ladderLimits.test.ts` asserts
the shipped count below −60 dBr on the worst cells.

### Aliasing (reading 3)

`aliasing.mjs`, k 16.5, a sine sweep (11 frequencies from 110 Hz to
10.6 kHz, each on a prime bin of a 16 384-point transform, so the periodic
output's harmonics fall in exact bins and every other bin is a product
that folded back), the loudest aliased product in dB against the input
sine. At full scale (peak 1 in the carrier's units, the most the voice's
drive passes on):

| cutoff | 1× four steps | 2× three steps, three-tap decimator |
|---|---|---|
| 500 Hz | −75.1 | −92.7 |
| 1 kHz | −71.8 | −77.7 |
| 2 kHz | −59.7 | −74.8 |
| 5 kHz | −49.5 | −60.5 |
| 10 kHz | −36.9 | −55.9 |
| 18 kHz | (capped) | −52.6 |

At peak 4 (8 in the ladder's units, the matrix's hot cell) 1× reads −52.7,
−48.9, −47.3, −43.9 and −40.4 dBr at 500 Hz to 10 kHz, and 2× −72.2,
−59.8, −52.4, −49.3, −46.9 and −46.4 to 18 kHz. The worst products come
from the sweep's top two frequencies, 7 and 10.6 kHz. The 2× candidate
read without a decimator (the last sub-step taken) and with a seven-tap
half-band within 2 dB of the three-tap: what folds comes from above the
oversampled rate, so a longer decimator buys nothing here. Over the stock
unit's range (500 Hz to 2 kHz) the shipped solver's aliasing at full scale
stays at or under −60 dBr; it is worst where the cutoff is open and the
input is a high, hot sine, which an acid line rarely is.

### Cost (reading 2)

`ladderBench.mjs`, the ladder alone, a 110 Hz saw at k 16.5, 20 s three
times: **1× 240.2, 239.6 and 246.8 ns a sample; 2× 366.3, 363.8 and
363.5**. Four Newton steps of five rational evaluations and a 4 × 4
elimination are about 60 ns each, and division is not most of it: in a
scratch copy of the solve, replacing the saturator's five divisions with
multiplies read 24 ns a sample less, the elimination's four 29 ns less,
of about 290.

`bench.mjs`, the Formant bench's eight held voices of `pad-drift`, 20 rounds
of 2 s per variant, ns per voice-sample (and against the same bundle's Off,
median [IQR]):

| variant | run 1 | | run 2 | | without Acid in the run | |
|---|---|---|---|---|---|---|
| before Off | 25.22 | | 25.37 | | 25.14 | |
| before LP 12 | 27.88 | +2.57 [2.50, 2.76] | 28.05 | +2.69 [2.52, 2.82] | 27.95 | +2.80 [2.59, 2.89] |
| before BP 12 | 27.99 | +2.71 [2.62, 3.00] | 28.05 | +2.69 [2.56, 2.85] | 28.08 | +2.85 [2.70, 2.95] |
| before LP 24 | 30.76 | +5.36 [5.25, 5.73] | 30.79 | +5.48 [5.21, 5.60] | 30.65 | +5.46 [5.31, 5.53] |
| before Formant | 33.70 | +8.39 [8.31, 8.70] | 33.83 | +8.55 [8.30, 8.68] | 33.75 | +8.51 [8.32, 8.67] |
| engine Off | 25.46 | | 25.49 | | 25.27 | |
| engine LP 12 | 28.35 | +2.90 [2.76, 3.05] | 28.44 | +2.92 [2.83, 3.08] | 27.86 | +2.61 [2.54, 2.69] |
| engine BP 12 | 28.51 | +3.05 [2.94, 3.19] | 28.44 | +2.92 [2.78, 3.14] | 27.92 | +2.63 [2.55, 2.76] |
| engine LP 24 | 31.80 | +6.31 [6.21, 6.54] | 31.92 | +6.37 [6.31, 6.63] | 31.14 | +5.76 [5.66, 5.97] |
| engine Formant | 34.44 | +8.96 [8.79, 9.96] | 34.53 | +9.01 [8.76, 9.70] | 33.71 | +8.46 [8.33, 8.58] |
| **engine Acid 1×4** | **268.55** | +242.88 [242.31, 244.43] | **270.71** | +244.84 [242.55, 246.79] | | |
| engine Acid 2×3 | 394.40 | +368.96 [367.51, 372.60] | 395.93 | +369.76 [368.47, 371.02] | | |

- **The mode.** An Acid voice costs 269 to 271 ns a voice-sample on the
  shipped candidate, about 8.5× an LP 24 voice and 38× the 24 dB pair's
  own cost; the 2× candidate 394 to 396. At 48 kHz one Acid voice is about
  1.3 % of a core, a mono acid line well within a part's budget, eight
  held at once about 10 %.
- **The other modes.** With no Acid voice in the run every mode costs what
  it did, within 0.5 ns (the third pair of columns). Once an Acid voice has
  played in the same bundle, Off is within 0.2 ns, LP 12 and BP 12
  0.4–0.5 ns more, Formant 0.7 ns and LP 24 1.0–1.1 ns (3.5 %): the
  kernel's code for the other modes changes once the Acid branch is
  reached. A store left on that branch accounts for part of it (removing
  it in a scratch copy took LP 24 to +0.65 ns).
- **Why the ladder is a pass after the loop.** The first build called
  `process` from the sample loop, through `point`, as the record's
  decision 8 had it. V8 did not inline it (too long), but the call alone,
  once reached, cost every mode about 1.5 ns a voice-sample (Off 25.97 →
  27.57, LP 12 +2.46 → +4.55 against Off; a short run, 3 rounds of 1 s),
  as V8 spills the loop's live doubles around a call it does not inline;
  replacing the call with an inline multiply in a scratch copy of the
  bundle took every mode back to before. So the loops leave each sample in
  the ladder's `chunk` and `renderVoiceLadder` runs the ladder, the fade
  and the pan over the chunk after the loop, one call a chunk. The serial
  modes are tested first in the filter branch, so they compare the mode as
  often as before Acid joined.

### Large signals

`ladderLimits.test.ts` asserts these; the values read:

- **Harmonics.** A 110 Hz sine at ladder amplitude 2 through 1 kHz, k 12:
  H3 −55.0 dB, H2 −205 dB (odd only), as the prototype's −55 with the true
  tanh.
- **The high-pass.** At k 16 the resonant peak reads +0.8 dB at a 5 kHz
  cutoff and −12.3 dB at 500 Hz, as the one-pole model's table above.
- **Bounds.** A full-scale white-noise burst at 64× through the top cutoff
  peaks at 0.51 (carrier units) at k 0 and 16.5; a 64× 50 Hz square at
  1.43; a cutoff sweep 30 Hz → 10 kHz → 30 Hz over 50 ms at k 16.5 at 0.09
  (1×) and 0.28 (64×). The saturator holds each diode pair's current at
  ±1 past |x| = 4.97, so a state stops where its pair saturates and x₄
  settles near 5 (2.5 in the carrier's units) at most; the test's bound is
  4.
- **Threshold.** At a 5 kHz cutoff the loop decays at 0.99 × the analog
  threshold with the high-pass at the bilinear image (17.6) and grows to a
  held oscillation at 1.1 ×; k 16.5 decays after an impulse at 100 Hz,
  500 Hz, 2 kHz, 5 kHz and 10 kHz.

## The sound-design pass (windsor#574)

Three factory acid patches, an audition song, a comparison rig against
Roland's TB-303 software instrument, and the three sound-design tunables
set from it: `LADDER_FEEDBACK_MAX` stays **16.5**, `LADDER_FEEDBACK_HP_HZ`
moves from 150 to **100** Hz and `LADDER_INPUT_SCALE` from 2 to **1**
(windsor#577 moved the last two again, to 150 Hz and 0.25, when it added
the output mix and re-fitted the patches' volumes: the last section).
The sections above were read at 150 Hz and scale 2 (their conversions to
the carrier's units divide by 2). Sound calibration stays provisional until
tacowars has listened against the references. Every number below is
measured on the shipped bundle under Node 24.21.0 from seeded renders; none
is a performance reading.

### The patches

`packages/engine/src/patches/acid-*.json`, category Basses, tags `acid`,
`bass`, `303`, `mono`. Each is one carrier into the Acid mode (mode 6),
`mono`, the amp envelope a 1 ms attack, a 1.6 s decay to 0.55 and a 20 ms
release, key track 0, Drive on with the `soft` shape:

| patch | carrier | Cutoff | Reso (knob travel) | env amount | wheel | filter decay | drive gain | volume | velSens |
|---|---|---|---|---|---|---|---|---|---|
| `acid-saw` | `SAW` | 300 Hz | 5.0 (72 %) | 3 oct | 1.5 oct | 0.25 s | 3 | 0.35 | 0.35 |
| `acid-square` | `SQUARE` | 260 Hz | 5.5 (75 %) | 3.5 oct | 1.5 oct | 0.30 s | 3 | 0.35 | 0.35 |
| `acid-accent` | `SAW` | 220 Hz | 6.0 (78 %) | 2 oct | 3.5 oct | 0.15 s | 4 | 0.40 | 0.6 |

The filter envelope has no attack and no sustain. A Grid accent sends a mod
of 1, which adds `filter.modWheelDepth` to the envelope amount, so an accent
opens the sweep as the wheel does; `acid-accent` keeps its plain notes dark
(2 octaves) and lets an accent open 3.5 octaves further.

**Glide is 0, not the brief's 60–120 ms.** A patch's `glide` is portamento
on every note in `mono` (`fmProcessor.ts`: each new voice starts from the
last note when `glide > 0`), so a TB-303 line with a glide would bend into
every step, slid or not. With `glide` 0 only a Grid slide glides, over the
engine's `SLIDE_SECONDS_DEFAULT` (60 ms, the low end of the brief's range),
and a plain step jumps, as the TB-303's does. `extra-acid-saw-glide-0.08.wav`
in the listen folder plays the other choice.

**Level.** C2 and C3 held 1 s at velocity 1 peak at −18.5 (`acid-saw`),
−16.3 (`acid-square`) and −17.1 dBFS (`acid-accent`) over four seeds, far
from a clip (the acceptance's check). That is quiet: the saw line's RMS is
about 9 dB under `score-dockside-bass` playing the same line. The ladder's
passband falls with resonance (record decision 7, no makeup) and the
drive's `soft` shape holds the ladder's input to ±1 whatever the volume,
so the patch cannot be louder without less resonance; the song's strips
carry +6 dB (level 2).

**The voice's end.** An Acid voice ends 0.31–0.55 s after the note-off
(the ladder's feedback loop through its high-pass has a mode of about
20 ms, and the voice ends when every ladder state is under the dormancy
floor, about −180 dB). `patch/patchLibraryEnvelope.test.ts` gave a
released note 0.1 s past its release, which no Acid patch with resonance
meets at any of the tunables' values (0.31–0.43 s at the record's), so the
test now allows an Acid patch 0.6 s more.

**The sweep.** `audition/sweep.mjs` plays A2 at velocity 0.8, plain and
accented, and reads the resonance's emphasis (the neighbouring harmonics
that rose most against the same note with Reso at its bottom) in 43 ms
windows. The peak moves with the envelope, and an accent starts it higher
(Hz, every other window):

| ms | saw | saw, accent | square | square, accent | `acid-accent` | `acid-accent`, accent |
|---|---|---|---|---|---|---|
| 21 | 2403 | 6600 | 2970 | 8030 | 922 | 7920 |
| 64 | 2178 | 5709 | 2750 | 7150 | 805 | 5940 |
| 107 | 1941 | 4607 | 2310 | 6050 | 592 | 3278 |
| 149 | 1512 | 3287 | 2090 | 4730 | 339 | 701 |
| 192 | 1149 | 2063 | 1650 | 3410 | 228 | 228 |
| 235 | 586 | 820 | 1210 | 2090 | 228 | 228 |
| 277 | 339 | 339 | 549 | 761 | 228 | 228 |

The lift is 9–12 dB at the top of the sweep and 5–7 dB at its foot, where
the feedback's high-pass damps the resonance (the low-cutoff thinning the
record describes).

### The audition song

`audition/acid-audition.song.json`, for the Settings tab's Import on the
PR preview: 8 bars at 128 BPM in A natural minor, three Grid parts of 16
sixteenths at register octave 1 (A1 = MIDI 33), each line in the first and
second octaves with accents, slides and ties, part velocity 0.8, accent
velocity +0.2 and accent mod 1:

1. **Acid Saw**, bars 1–2 alone, then bars 7–8.
2. **Acid Square**, bars 3–4 alone, then bars 7–8 with the saw.
3. **Acid Accent**, bars 5–6 alone: nine accents in sixteen steps.

`audition/acid-saw.patch.json`, `acid-square.patch.json` and
`acid-accent.patch.json` are the patches alone, for the Parts tab's JSON
dialog. The song carries a snapshot of each.

### The ACB comparison

`reference/compare.mjs <303-filter folder>` reads the eight recordings
tacowars made from Roland's TB-303 software instrument (ACB 1.0.9; the
recipe, the note timeline and the SHA-256 of every file are in that
folder's `settings.txt`). It refuses a file whose hash is not
`settings.txt`'s, reads each in place and copies nothing. For every
recording, note and Cut Off section it measures a window 0.5–1.8 s into the
held note: harmonics 1–16 in dB against the same waveform's 0 % resonance,
24.78 % Cut Off, note 33 fundamental (nothing normalised), the resonance's
emphasis (the up to three neighbouring harmonics that rose most against
0 % resonance: their power-weighted frequency and their lift) and the
spectral centroid. It renders Windsor's `acid-saw` and `acid-square`
reduced to the recipe (one carrier, drive off, envelope amount 0, the amp
envelope held, velocity sensitivity 0, the carrier's peak 1 into the
ladder) through `scripts/sound-match/render.mjs`, at the same notes with a
2 s gate and the Reso knob at 0, 50, 90 and 100 % of its travel, which on
its log sweep (0.5 × 24^t) is reso 0.5, 2.45, **8.74** and 12 (the brief's
9.5 is 93 %). `--set NAME=value` renders a tunable variant through
`audition/bundleVariant.mjs`, the shipped bundle's text with that one
number changed (with no override it renders as `render.mjs` does, to the
bit). `reference/compare.txt` is its output on the shipped values with
`--cells`: the side-by-side table for every wave, section, note and
resonance.

**The Cut Off map.** Each section's Windsor cutoff is the one whose
emphasis at reso 12 on note 33 falls where the ACB's does at 100 %
resonance (the geometric mean of saw and square):

| ACB Cut Off | ACB emphasis | Windsor cutoff (shipped values) |
|---|---|---|
| 24.78 % | 279 Hz | 199 Hz |
| 49.38 % | 397 Hz | 314 Hz |
| 75.05 % | 773 Hz | 630 Hz |
| 100 % | 1713 Hz | 1465 Hz |

**The emphasis** on the shipped values, its lift in dB against 0 %
resonance, the mean of notes 33, 45 and 57:

| wave | Cut Off | ACB at 50 / 90 / 100 % | Windsor at 50 / 90 / 100 % |
|---|---|---|---|
| saw | 24.78 % | 6.8 / 12.4 / 13.6 | 3.5 / 5.6 / 6.0 |
| saw | 49.38 % | 7.4 / 15.8 / 17.9 | 3.9 / 7.4 / 8.4 |
| saw | 75.05 % | 9.1 / 18.3 / 20.5 | 5.3 / 10.3 / 11.7 |
| saw | 100 % | 10.6 / 22.9 / 27.2 | 6.0 / 13.1 / 15.9 |
| square | 24.78 % | 6.3 / 12.4 / 13.7 | 1.0 / 3.7 / 4.3 |
| square | 49.38 % | 7.0 / 15.5 / 17.7 | 2.5 / 4.9 / 5.8 |
| square | 75.05 % | 8.2 / 17.9 / 20.6 | 4.9 / 10.4 / 11.5 |
| square | 100 % | 10.6 / 22.6 / 27.8 | 5.7 / 13.7 / 15.7 |

**Every tunable, one at a time from the record's values** (16.5, 150 Hz,
2), then the shipped set and two of its neighbours. The lift gap is
Windsor's emphasis lift minus the ACB's, the mean over waves, sections and
notes. Shape is harmonics 2–16 against each note's own fundamental, and
level harmonics 1–16 against the reference, Windsor minus ACB, RMS dB over
the harmonics both hold above −90 dB (the square's odd harmonics only: the
ACB's square carries even harmonics, H2 16 dB under H1, and Windsor's
`SQUARE` none). Bass is each note's fundamental at 50, 90 and 100 %
resonance against its own 0 %, Windsor minus ACB, notes 33 and 45, RMS and
mean dB:

| variant | Cut Off map, Hz | lift gap at 50 / 90 / 100 % | shape at 0 %, saw / square | shape at 100 %, saw / square | level at 100 %, saw / square | bass, 24.78 and 49.38 % | bass, every section |
|---|---|---|---|---|---|---|---|
| record (16.5, 150, 2) | 235, 311, 641, 1473 | −4.1 / −10.3 / −11.9 | 7.68 / 6.98 | 15.70 / 12.04 | 20.16 / 13.91 | 4.31, +3.91 | 3.42, +2.21 |
| max 15.5 | 224, 318, 669, 1514 | −4.5 / −10.8 / −12.6 | 7.54 / 7.09 | 15.75 / 12.27 | 19.36 / 13.50 | 4.67, +4.33 | 3.66, +2.57 |
| max 17 | 197, 311, 637, 1463 | −4.0 / −10.2 / −11.8 | 8.16 / 6.74 | 16.33 / 12.75 | 19.65 / 13.69 | 4.62, +4.30 | 3.61, +2.31 |
| high-pass 100 | 223, 333, 665, 1483 | −3.6 / −9.6 / −11.1 | 7.47 / 7.09 | 13.84 / 10.31 | 19.32 / 13.01 | 2.93, +2.46 | 2.85, +0.40 |
| high-pass 250 | 230, 291, 612, 1463 | −5.0 / −11.3 / −13.2 | 8.11 / 6.76 | 18.22 / 15.04 | 20.37 / 15.02 | 6.36, +6.02 | 5.34, +4.79 |
| input 1 | 201, 296, 624, 1436 | −4.5 / −9.6 / −11.2 | 6.50 / 7.15 | 13.24 / 9.84 | 17.93 / 13.60 | 2.62, +2.42 | 2.41, +0.50 |
| input 4 | 229, 337, 668, 560 | −4.6 / −11.0 / −12.9 | 14.18 / 9.38 | 24.31 / 19.13 | 25.92 / 17.78 | 7.34, +6.87 | 6.96, +6.46 |
| **shipped (16.5, 100, 1)** | 199, 314, 630, 1465 | −4.1 / −8.6 / −10.0 | 6.37 / 7.31 | 11.49 / 8.65 | 17.50 / 13.29 | 1.33, +0.86 | 2.94, −1.34 |
| shipped, max 17 | 201, 314, 635, 1449 | −4.0 / −8.2 / −9.6 | 6.34 / 7.33 | 11.21 / 8.47 | 17.46 / 13.44 | 1.19, +0.63 | 3.05, −1.57 |
| shipped, high-pass 50 | 233, 339, 655, 1478 | −3.6 / −7.3 / −8.5 | 5.88 / 7.85 | 8.22 / 6.94 | 17.34 / 13.46 | 2.22, −1.81 | 4.79, −3.93 |

(Input 4's top section fitted on a lower peak: with the ladder that hot the
emphasis at reso 12 never reaches the target, and the fit lands at 560 Hz.)

**The proposal, tunable by tunable.**

- **The Reso pot law: keep it.** In dB, the ACB's lift at 50 % travel is
  43 % (saw) and 40 % (square) of its lift at 100 %, and at 90 % it is 88 %
  and 86 %; Windsor's `p` gives 45 % and 38 %, 87 % and 88 % (the means
  over sections in the emphasis table). The proportions agree within three
  points; what differs is the scale, below, which neither the law nor the
  ceiling carries.
- **The feedback ceiling: keep 16.5**, the record's value: the table is
  silent. 17 against 16.5 moves the lift gap by 0.4 dB and the errors by
  0.3 dB at most, and 15.5 the other way by as little. The ACB's 100 %
  lifts 1.2–5.2 dB more than its 90 %, Windsor's 0.4–2.8 dB, and no
  ceiling short of oscillation closes that.
- **The high-pass corner: 100 Hz** (from 150). From the record's values,
  100 Hz takes the bass error at the 24.78 and 49.38 % sections, where the
  corner matters, from 4.3 to 2.9 dB RMS (1.3 with input 1), narrows the
  lift gap by 0.5–0.8 dB and the 100 % shape error by about 2 dB. Below
  100 Hz the lift keeps rising but the bass loss overshoots the ACB's (50 Hz
  on the shipped set: −1.8 dB at the low sections, −3.9 dB over every
  section), and 250 Hz is worse on every column. 100 is the lowest of the
  listen's three values.
- **The input scale: 1** (from 2). With the carrier's full level, the
  drive's ceiling, at one 2 V_T unit, the shape and level errors fall at
  every resonance (saw at 0 %: shape 7.7 → 6.5 dB; at 100 %: 15.7 → 13.2)
  and the bass error is lowest; 4 is worse everywhere. The rig fixes the
  level, and level and scale trade one for one (the rig at level 0.5 and
  scale 2 reads exactly as at level 1 and scale 1), so what this measures
  is that the ACB behaves like a ladder fed one unit at its oscillator's
  full level, which scale 1 puts at the patches' ceiling. The ladder then
  saturates mildly (H3 about −67 dB for a full-level sine at k 12, the
  large-signal table above): the squelch comes from the drive and the
  resonance more than from the ladder's own diodes.

**What no tunable reaches.** On the shipped values Windsor's resonance
lifts 8.6 and 10.0 dB less than the ACB's at 90 and 100 % (7.3–13.2 dB
across every variant tried). At a matched emphasis Windsor's 0 % resonance
is also 8–10 dB darker an octave above the fundamental (saw, 24.78 %,
note 45: H1 −6.5 dB against the ACB's +1.8, H2 −22.7 against −13.1,
`compare.txt`): the ACB's zero-resonance roll-off starts within about an
octave of its emphasis, the ladder's three octaves under its cutoff (record
decision 5). That is the model's shape, not a tunable's; the record's
deferred circuit reduction of the resonance return is where it would be
looked at. The upper sections also lose 3–6 dB more bass with resonance
than the ACB's (the passband's 1 / (1 + k) at high cutoffs). The
recordings are the whole Roland voice, so some of this is its oscillator
and VCA: they are behavioural references, never goldens.

### The tunables' listen

`audition/renderTunables.mjs <out dir>` renders, for each tunable at each
of the brief's three values with the other two at the shipped values, the
song's three lines one after another (each line twice, its own patch alone,
half a second apart), as the Grid plays them, levels as rendered. The nine
files went to `~/Desktop/acid-tunables/` for tacowars's listen, never into
the repository. Per part (saw / square / `acid-accent`), the RMS level and
the median spectral centroid:

| file | RMS dBFS | centroid Hz | against the shipped values |
|---|---|---|---|
| `LADDER_FEEDBACK_MAX-15.5.wav` | −29.3 / −24.6 / −26.3 | 670 / 835 / 1536 | 0.4 dB louder, a touch less resonant |
| `LADDER_FEEDBACK_MAX-16.5.wav` (shipped) | −29.7 / −25.0 / −26.7 | 695 / 871 / 1635 | |
| `LADDER_FEEDBACK_MAX-17.wav` | −29.9 / −25.2 / −26.9 | 709 / 890 / 1686 | a touch more resonant |
| `LADDER_FEEDBACK_HP_HZ-100.wav` (shipped) | −29.7 / −25.0 / −26.7 | 695 / 871 / 1635 | the leanest bass, the resonance most forward |
| `LADDER_FEEDBACK_HP_HZ-150.wav` | −27.7 / −22.7 / −24.6 | 628 / 776 / 1456 | 2 dB louder, more fundamental |
| `LADDER_FEEDBACK_HP_HZ-250.wav` | −24.6 / −19.3 / −21.6 | 526 / 639 / 1189 | 5 dB louder, the bass back, the resonance thinner |
| `LADDER_INPUT_SCALE-1.wav` (shipped) | −29.7 / −25.0 / −26.7 | 695 / 871 / 1635 | the cleanest, the resonance brightest |
| `LADDER_INPUT_SCALE-2.wav` | −29.5 / −25.1 / −26.3 | 577 / 719 / 1294 | darker: the ladder compresses the peak |
| `LADDER_INPUT_SCALE-4.wav` | −29.1 / −25.2 / −26.3 | 461 / 569 / 978 | darkest and most saturated |

`extra-acid-saw-glide-0.wav` and `extra-acid-saw-glide-0.08.wav` are the
saw's line with the patch's glide at 0 (shipped: only the slides glide) and
at 0.08 s (every note bends from the last).

## The output mix (windsor#577)

tacowars's listen of windsor#574 on its preview: with resonance off and the
cutoff open the Acid and SVF modes sit at a similar level, but as Reso rises
the Acid mode's level falls far more than a TB-303's, a TD-3's or the
emulations', and it does not squelch. The model had only the loop. On the
service notes' schematic the resonance pot's wiper also feeds the VCA,
through its own 10 nF / 100 kΩ beside the ladder output's 10 nF / 220 kΩ
(C21, C22 and R121 by IC15), so what is heard is the ladder's output plus a
resonance-proportional, high-passed copy of it. `ladder.ts` now leaves

    y_out = y + LADDER_MIX_GAIN × p × hp_mix(y)

with y the ladder's output (scaled, polarity as before), p the Reso knob's
place (the feedback's own p) and hp_mix a TPT one-pole high-pass at
`LADDER_MIX_HP_HZ`: a post-stage after the solve, so the loop, its Jacobian
and its tuning are untouched. `tuneLadder` sets the high-pass's coefficient
once per sample rate and the gain with k. With p = 0 the sum is skipped and
the output is the solve's own to the bit (`ladder.test.ts` pins it sample by
sample); the high-pass runs either way, so a Reso that rises mid-note meets
a settled state, and `quiet` and `reset` include its state. On the bundle,
with `LADDER_INPUT_SCALE` set back to origin/main's 1, `acid-saw`,
`acid-square` and `acid-accent` with the Reso knob at its bottom render bit
for bit as origin/main's at notes 33, 45 and 57, plain and accented
(eighteen renders). The shipped input scale moves (below), so the shipped
p = 0 render is not origin/main's.

**The linear model.** `outmix.mjs` (from the ticket's planning, with a
header) puts the mix at the schematic's 2.2 (220 kΩ / 100 kΩ) and 159 Hz
around the loop's analog response: it moves both the lift and the bass
toward the ACB's, and overshoots the lift (34 dB at the 100 % section
against the ACB's 27.2), because the linear loop's lift is not capped by
the input pair's saturation as the solver's is.

**The rig.** `compare.mjs` takes `--set LADDER_MIX_GAIN=…` and
`--set LADDER_MIX_HP_HZ=…` (`audition/bundleVariant.mjs`), and prints one
more summary: per resonance, the emphasis lift gap and the level, both
Windsor minus ACB and the mean over sections and notes, the level as the
power sum of the harmonics both hold (the level column's harmonics) and as
a change from the same cell at 0 %. Run with the mix off it prints
origin/main's numbers exactly.

**The fit.** 149 variants over `LADDER_INPUT_SCALE` (1, 0.5, 0.25),
`LADDER_FEEDBACK_HP_HZ` (50–200), `LADDER_MIX_GAIN` (1.5–3) and
`LADDER_MIX_HP_HZ` (160–600), `LADDER_FEEDBACK_MAX` at 16.5 throughout.
Every row is in `reference/mix-fit.txt`; 36 of them meet every rig
acceptance of the ticket. The rows that decide it (lift gap, level change
and bass in dB, Windsor minus ACB; shape and level RMS dB):

| scale | feedback HP | mix | mix HP | lift gap 50 / 90 / 100 % | shape at 0 %, saw / square | level at 0 %, saw / square | bass, 24.78 + 49.38 %, RMS, mean | bass, every section, RMS, mean | level change at 90 / 100 % |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 100 | off | — | −4.1 / −8.6 / −10.0 | 6.37 / 7.31 | 8.68 / 6.72 | 1.33, +0.86 | 2.94, −1.34 | −4.27 / −4.91 |
| 1 | 100 | 2.2 | 160 | +1.8 / +0.3 / −0.4 | 6.42 / 7.27 | 8.67 / 6.71 | 4.84, +4.57 | 3.69, +2.31 | +1.96 / +1.94 |
| 0.25 | 100 | off | — | −3.0 / −7.0 / −8.2 | 5.66 / 8.09 | 7.90 / 7.08 | 0.92, −0.53 | 3.25, −2.39 | −4.81 / −5.46 |
| 0.25 | 100 | 2.2 | 160 | +3.0 / +2.1 / +1.5 | 5.68 / 8.07 | 7.85 / 7.07 | 3.41, +3.13 | 2.72, +1.25 | +1.65 / +1.69 |
| 1 | 100 | 3 | 400 | +1.8 / +0.8 / +0.1 | 6.15 / 7.46 | 9.08 / 7.05 | 2.21, +1.98 | 2.42, +0.03 | +0.36 / +0.38 |
| 1 | 150 | 2.2 | 400 | +0.1 / −2.3 / −3.2 | 6.75 / 7.11 | 9.28 / 6.93 | 3.94, +3.86 | 2.98, +1.75 | +0.21 / +0.03 |
| 0.5 | 150 | 2.6 | 400 | +1.5 / −0.2 / −1.0 | 5.94 / 7.62 | 8.24 / 6.95 | 3.02, +2.96 | 2.36, +1.17 | +0.40 / +0.32 |
| 0.25 | 50 | 2.2 | 400 | +2.5 / +2.2 / +2.0 | 5.54 / 8.47 | 7.54 / 7.07 | 2.20, −1.59 | 4.50, −3.62 | −0.96 / −0.58 |
| 0.25 | 125 | 2.6 | 400 | +1.9 / +0.7 / −0.1 | 5.87 / 7.71 | 8.42 / 7.22 | 2.26, +2.16 | 2.23, +0.19 | +0.30 / +0.30 |
| 0.25 | 150 | 2.2 | 160 | +2.3 / +0.8 / −0.1 | 5.76 / 7.86 | 8.02 / 7.05 | 4.97, +4.85 | 3.79, +3.17 | +2.24 / +2.18 |
| 0.25 | 150 | 2.2 | 400 | +1.0 / −0.8 / −1.6 | 5.88 / 7.70 | 8.07 / 7.00 | 2.67, +2.62 | 2.21, +0.80 | −0.11 / −0.23 |
| **0.25** | **150** | **2.6** | **400** | **+1.7 / +0.2 / −0.7** | **5.88 / 7.69** | **8.07 / 6.99** | **2.95, +2.89** | **2.33, +1.07** | **+0.49 / +0.44** |
| 0.25 | 150 | 3 | 400 | +2.3 / +1.0 / +0.2 | 5.89 / 7.69 | 8.06 / 6.98 | 3.24, +3.17 | 2.48, +1.34 | +1.07 / +1.07 |
| 0.25 | 150 | 2.6 | 600 | +0.7 / −1.1 / −1.9 | 5.94 / 7.62 | 8.14 / 6.99 | 2.43, +2.37 | 2.20, +0.48 | −0.52 / −0.63 |
| 0.25 | 200 | 2.6 | 400 | +1.1 / −1.0 / −1.9 | 6.34 / 7.33 | 8.65 / 7.11 | 4.67, +4.61 | 3.47, +2.80 | +1.31 / +1.21 |

- **The schematic's values close the lift and return the level, but give
  back too much bass.** At 2.2 and 160 Hz the lift gap is within 3 dB at
  every resonance at either input scale, but the mix returns the bass the
  loop takes: the low sections then lose 3–5 dB less than the ACB's. The
  one-pole's corner stands for the hardware's coupling into the VCA, not
  for the two parts alone; the rig puts it near **400 Hz**, where the bass
  meets the acceptance and the lift keeps it, and a gain of **2.6** centres
  the lift gap (2.2 leaves it 1.6 dB short at 100 %, 3 passes +2 at 50 %).
- **The input scale: 0.25**, as the ticket proposed. Of the 36 variants
  that meet everything, 24 are at 0.25 and 11 at 0.5; at 1 only mix 3 at
  400 Hz does, on a Cut Off map whose first section jumped to 224 Hz. At
  0.25 the input pair compresses the resonance less (with the mix off the
  100 % lift gap reads −8.2 against −10.0 at 1) and the saw's 0 % shape and
  level errors fall (5.88 and 8.07 against 6.37 and 8.68); the square's
  0 % shape error rises, past the acceptance with the feedback's high-pass
  at 100 Hz (8.07 against 7.31 + 0.5) and within it at 150 Hz (7.69).
- **The feedback's high-pass: back to 150 Hz** (Open303's value, still a
  calibration). With the mix returning bass, windsor#574's 100 Hz takes too
  much at the low sections and darkens the square's 0 % shape at scale
  0.25; 150 Hz meets both. 125 Hz meets everything too, at the edge of the
  square's 0 % level (7.22 against 7.22); 200 and 50 Hz miss the bass.
- **No makeup.** The level with resonance, as a change from 0 %, is now
  +0.49 and +0.44 dB against the ACB's at 90 and 100 % (−4.27 and −4.91
  before): the circuit's two paths return it, and decision 7's makeup is
  not needed. Read as it is rather than as a change, the level at 90 and
  100 % is −5.70 and −5.75 dB, the 0 % offset (−6.19 dB: Windsor's
  zero-resonance roll-off starts three octaves under its cutoff, so the
  low sections' higher notes are darker than the ACB's) carried up. A
  makeup is unity at p = 0 and cannot move that offset; one that lifted the
  level as read to within 3 dB (+2.75 dB at p = 1) would put the bass's
  mean near +3.3 dB and the 50 % lift gap at +3.2.

**Before and after**, the rig's summaries on origin/main's values and on
the shipped ones (`reference/compare.txt` is the shipped run with
`--cells`):

| | Cut Off map, Hz | lift gap 50 / 90 / 100 % | shape at 0 %, saw / square | level at 0 %, saw / square | shape at 100 %, saw / square | level at 100 %, saw / square | bass, 24.78 + 49.38 % | bass, every section | level at 90 / 100 % | level change at 90 / 100 % |
|---|---|---|---|---|---|---|---|---|---|---|
| origin/main (16.5, 100 Hz, 1, no mix) | 199, 314, 630, 1465 | −4.1 / −8.6 / −10.0 | 6.37 / 7.31 | 8.68 / 6.72 | 11.49 / 8.65 | 17.50 / 13.29 | 1.33, +0.86 | 2.94, −1.34 | −10.14 / −10.78 | −4.27 / −4.91 |
| shipped (16.5, 150 Hz, 0.25, mix 2.6 at 400 Hz) | 196, 291, 608, 1429 | +1.7 / +0.2 / −0.7 | 5.88 / 7.69 | 8.07 / 6.99 | 5.90 / 7.33 | 7.45 / 5.92 | 2.95, +2.89 | 2.33, +1.07 | −5.70 / −5.75 | +0.49 / +0.44 |

The bass by section, RMS and mean dB, before → after: 24.78 % 1.62, +1.41 →
3.12, +3.08; 49.38 % 0.94, +0.32 → 2.77, +2.70; 75.05 % 2.46, −2.22 → 0.66,
+0.29; 100 % 5.01, −4.87 → 1.95, −1.82. The upper sections' excess loss
(the passband's 1 / (1 + k)) is gone; the low sections now keep about 3 dB
more bass than the ACB's, the price of the mix, and no variant in the table
holds every section under 2.5 dB RMS at once while meeting the lift.

The emphasis lift, the mean of notes 33, 45 and 57, at 50 / 90 / 100 %:

| wave | Cut Off | ACB | origin/main | shipped |
|---|---|---|---|---|
| saw | 24.78 % | 6.8 / 12.4 / 13.6 | 3.5 / 5.6 / 6.0 | 6.3 / 10.8 / 11.8 |
| saw | 49.38 % | 7.4 / 15.8 / 17.9 | 3.9 / 7.4 / 8.4 | 8.3 / 14.4 / 16.0 |
| saw | 75.05 % | 9.1 / 18.3 / 20.5 | 5.3 / 10.3 / 11.7 | 11.6 / 19.7 / 21.6 |
| saw | 100 % | 10.6 / 22.9 / 27.2 | 6.0 / 13.1 / 15.9 | 13.8 / 24.6 / 28.7 |
| square | 24.78 % | 6.3 / 12.4 / 13.7 | 1.0 / 3.7 / 4.3 | 6.3 / 10.9 / 11.9 |
| square | 49.38 % | 7.0 / 15.5 / 17.7 | 2.5 / 4.9 / 5.8 | 7.8 / 13.3 / 14.4 |
| square | 75.05 % | 8.2 / 17.9 / 20.6 | 4.9 / 10.4 / 11.5 | 11.5 / 20.4 / 22.0 |
| square | 100 % | 10.6 / 22.6 / 27.8 | 5.7 / 13.7 / 15.7 | 13.9 / 25.1 / 27.3 |

**The small-signal response.** `ladder.test.ts` holds the shipped ladder at
the Reso knob's top to (1 + g HP_mix(s)) / (D(s) + k HP(s)) at the bilinear
image, 48 Hz to 2 f_c at 300 Hz, 2 kHz and 8 kHz, within 0.01 dB (the
acceptance asks 0.5 dB and 5°); the voice's white-noise test holds the
whole mode to it at k 0, 8 and 16.

**Large signals.** A 64× noise burst and a 64× square at the top cutoff
read 3.94 and 11.45 (carrier units) with the Reso knob at its bottom and
9.50 and 12.66 at its top, and the 30 Hz → 10 kHz → 30 Hz sweep at the
top 0.72 (1×) and 5.69 (64×): a scale of 0.25 lets four times as much out
of the ladder for the same state, and the mix adds up to 2g of it.
`ladderLimits.test.ts` bounds the output at 4 / scale × (1 + 2g). The
patches stay far under it: the drive's `soft` shape holds their ladder
input to ±1.

**The patches.** At the new values each patch keeps its Cutoff, Reso,
envelope and drive gain; its `volume`, which feeds the drive, moves so its
peak stays within 3 dB of origin/main's (C2 and C3 held 1 s at velocity 1,
seeds 0–3, `audition/sweep.mjs`'s clip check):

| patch | volume | peak, origin/main → shipped | line RMS, origin/main → shipped | line centroid, Hz |
|---|---|---|---|---|
| `acid-saw` | 0.35 → **0.22** | −18.5 → −15.9 dBFS | −29.7 → −29.2 dBFS | 715 → 1071 |
| `acid-square` | 0.35 → **0.28** | −16.3 → −13.4 dBFS | −25.0 → −22.7 dBFS | 745 → 1143 |
| `acid-accent` | 0.40 → **0.30** | −17.1 → −14.4 dBFS | −26.7 → −24.8 dBFS | 350 → 533 |

At their old volumes they peaked 3.9–5.5 dB over origin/main's. The line
columns are each audition line alone, two passes, as rendered (centroid:
the median over 2048-sample Hann windows above −60 dBFS, a different
reading from windsor#574's table). The sweep's emphasis follows the same
path as before (the saw from 2506 Hz at 21 ms to 353 Hz by 277 ms,
accented from 6704 Hz; the square from 2970, accented 8030; `acid-accent`
946, accented 8140), and its lift is 18–23 dB at the top of the sweep and
11–12 dB at its foot, against 9–12 and 5–7 before. The song's strips follow
the lines: 1.9, 1.55 and 1.6 (from 2), so each line sits within 0.5 dB of
its level in origin/main's song.

**The listen.** `audition/renderTunables.mjs` now renders windsor#574's
three tunables around the shipped values, the mix's two from the
schematic's values past the fit's, and for each patch a pair, its line
alone with the mix on (`<patch>-mix-on.wav`) and off (`<patch>-mix-off.wav`,
`LADDER_MIX_GAIN` 0). The files went to `~/Desktop/acid-tunables/`, never
into the repository; windsor#574's renders moved to its `before-577/`
folder. Per part (saw / square / `acid-accent`), RMS dBFS and the median
centroid, as above:

| file | RMS dBFS | centroid Hz |
|---|---|---|
| `LADDER_FEEDBACK_MAX-15.5.wav` | −28.8 / −22.3 / −24.5 | 1032 / 1096 / 515 |
| `LADDER_FEEDBACK_MAX-16.5.wav` (shipped) | −29.2 / −22.7 / −24.8 | 1071 / 1143 / 533 |
| `LADDER_FEEDBACK_MAX-17.wav` | −29.4 / −22.9 / −25.0 | 1091 / 1168 / 542 |
| `LADDER_FEEDBACK_HP_HZ-100.wav` | −30.6 / −24.6 / −26.4 | 1132 / 1246 / 588 |
| `LADDER_FEEDBACK_HP_HZ-150.wav` (shipped) | −29.2 / −22.7 / −24.8 | 1071 / 1143 / 533 |
| `LADDER_FEEDBACK_HP_HZ-250.wav` | −26.6 / −19.7 / −22.2 | 922 / 955 / 480 |
| `LADDER_INPUT_SCALE-0.125.wav` | −29.2 / −22.7 / −24.8 | 1075 / 1149 / 537 |
| `LADDER_INPUT_SCALE-0.25.wav` (shipped) | −29.2 / −22.7 / −24.8 | 1071 / 1143 / 533 |
| `LADDER_INPUT_SCALE-1.wav` | −29.3 / −22.8 / −25.0 | 1005 / 1050 / 496 |
| `LADDER_MIX_GAIN-2.2.wav` (the schematic's) | −29.5 / −23.0 / −25.2 | 1044 / 1107 / 518 |
| `LADDER_MIX_GAIN-2.6.wav` (shipped) | −29.2 / −22.7 / −24.8 | 1071 / 1143 / 533 |
| `LADDER_MIX_GAIN-3.wav` | −28.8 / −22.4 / −24.5 | 1095 / 1174 / 545 |
| `LADDER_MIX_HP_HZ-160.wav` (the schematic's) | −26.9 / −20.5 / −22.5 | 957 / 1005 / 481 |
| `LADDER_MIX_HP_HZ-400.wav` (shipped) | −29.2 / −22.7 / −24.8 | 1071 / 1143 / 533 |
| `LADDER_MIX_HP_HZ-600.wav` | −29.8 / −23.2 / −25.4 | 1106 / 1178 / 539 |
| the `-mix-off.wav` files (`LADDER_MIX_GAIN` 0) | −31.2 / −24.0 / −26.5 | 742 / 733 / 367 |

**Cost**, on an Apple M1 under Node 24.21.0, the machine shared with other
sessions (load average 3.5–5). `ladderBench.mjs`, the ladder alone with the
mix at its full gain on this branch, eight interleaved pairs of runs of
`--seconds 40`, three readings each, median [range] ns a sample: the
shipped 1× candidate **244.7 [242.9–264.1] before and 248.8 [246.0–413.8]
after, +1.7 %**; the 2× candidate 371.0 → 377.5, +1.8 %. (Without
`--seconds` it read NaN; it now defaults to 20.) `bench.mjs . <origin/main
root> --rounds 20 --seconds 2 --beforeAcid 1`, eight held `pad-drift`
voices, Acid at Reso 9, two runs, ns per voice-sample and against the same
bundle's Off (median [IQR]):

| variant | run 1 | | run 2 | |
|---|---|---|---|---|
| before Off | 26.03 | | 25.98 | |
| before LP 12 | 28.99 | +2.88 [2.57, 3.08] | 28.98 | +3.00 [2.77, 3.25] |
| before BP 12 | 28.99 | +2.92 [2.81, 3.14] | 28.95 | +2.96 [2.69, 3.10] |
| before LP 24 | 32.52 | +6.40 [6.26, 6.66] | 32.53 | +6.57 [6.26, 6.96] |
| before Formant | 34.93 | +8.85 [8.44, 8.94] | 35.01 | +8.91 [8.63, 9.24] |
| before Acid 1×4 | 272.89 | +246.72 [246.24, 247.71] | 273.78 | +247.37 [246.52, 250.83] |
| engine Off | 25.95 | | 26.07 | |
| engine LP 12 | 28.90 | +2.93 [2.77, 3.12] | 29.02 | +3.02 [2.65, 3.43] |
| engine BP 12 | 28.93 | +2.95 [2.70, 3.18] | 29.17 | +3.00 [2.79, 3.41] |
| engine LP 24 | 32.35 | +6.40 [6.22, 6.57] | 32.58 | +6.54 [6.42, 6.84] |
| engine Formant | 34.84 | +8.78 [8.55, 9.07] | 34.97 | +8.96 [8.88, 9.16] |
| **engine Acid 1×4** | **278.04** | +252.10 [250.68, 257.27] | **279.09** | +252.85 [251.85, 254.74] |
| engine Acid 2×3 | 406.35 | +380.29 [379.20, 387.87] | 409.51 | +383.61 [380.55, 387.94] |

An Acid voice costs 1.9 % more (273 → 278–279 ns a voice-sample; the
ladder's own share 247 → 252–253, +2.2 %); every other mode is within
0.25 ns of before, inside the runs' spread.

## The makeup (windsor#587)

tacowars's listen of windsor#577: the character is right, smoother than
the SVF at low cutoffs and squelching when the resonance is high and the
cutoff opens, but the level falls as Reso rises. That fall is the
TB-303's own (the loop attenuates the passband between the feedback's
high-pass and the cutoff by about 1 / (1 + k), and the output mix returns
the peak and the lift but not the loudness), and it is a problem when the
Reso is performed. `ladder.ts` now multiplies its output, last, by

    makeup = (1 + k) ^ LADDER_MAKEUP_POWER

k the loop's feedback gain, the power shipped at **0.5** (record decision
11): 1 at the Reso knob's bottom and √17.5, **+12.4 dB**, at its top. It
is a scalar after the output mix and before the polarity, so nothing
nonlinear sees it; `tuneLadder` works it out beside k, only when k
changes, through `portablePowers.ts`'s `log2InPlace` and `exp2InPlace`
(no new power function was needed), and it steps with the Reso at the
control-block cadence k already does.

**Nothing but the gain.** `ladder.test.ts` runs a loud saw with noise on
it through the ladder at Reso floor, 25, 50, 75 and 100 % and holds each
output to the output with the makeup at 1 times (1 + k)^0.5, sample by
sample, within 1e-12 relative, and to the bit at the floor. On the bundle,
`acid-saw`, `acid-square` and `acid-accent` with the Reso knob at its
bottom render bit for bit as origin/main's at notes 33, 45 and 57, plain
and accented (18 of 18 renders, the patches as windsor#577 shipped them). The voice's white-noise test holds the
whole mode to the analog response plus the makeup's dB at k 0, 8 and 16.

**The patches.** The factory acid patches ship with the Drive off,
tacowars's decision on 2026-10-04: the Drive stage before the filter is
an optional push, not part of their gain staging, and the ladder's
calibration on the ACB rig was made with it off. Each patch's `drive.on`
is false, the drive's other fields as they were, and nothing else moves
but `volume`, which is now pure gain. It is set so the patch peaks between
0.6 and 0.75 at the loudest of C1, C2 and C3 held at velocity 1, with the
makeup in place (`patch/patchLibraryEnvelope.test.ts`'s render, which
requires under 0.8). The audition song's strips follow so each line plays
within 1 dB of its level on windsor#577 (line: the part alone, two passes,
as rendered; in the song, the line plus its strip's dB):

| patch | drive | volume | peak at C1 / C2 / C3 | line RMS, dBFS | strip | line in the song, dBFS |
|---|---|---|---|---|---|---|
| `acid-saw` | gain 3, on → **off** | 0.22 → **0.64** | **0.679** / 0.482 / 0.579 | −29.18 → −17.90 | 1.9 → **0.52** | −23.61 → −23.58 |
| `acid-square` | gain 3, on → **off** | 0.28 → **0.46** | **0.674** / 0.414 / 0.454 | −22.71 → −15.55 | 1.55 → **0.68** | −18.90 → −18.90 |
| `acid-accent` | gain 4, on → **off** | 0.30 → **0.68** | **0.681** / 0.430 / 0.483 | −24.84 → −17.10 | 1.6 → **0.66** | −20.76 → −20.71 |

With the drive off a patch's tone no longer depends on its `volume`, so
setting the level changes nothing else. `fmGolden.json` and
`fmGoldenFineInterval.json` change in the three acid rows each and
nowhere else. A patch whose Reso sits at its floor renders as it did
before the makeup; turned down from their own Reso, these three now hold
their level where on windsor#577 they grew louder.

**The listen.** `audition/renderTunables.mjs <out dir>` now renders, by
default, the song's three lines (each twice, its own patch alone, half a
second apart, the patches as shipped here, drive off) at the makeup's power 0
(the circuit's level), 0.35, 0.5 (shipped) and 0.7,
`LADDER_MAKEUP_POWER-<power>.wav`; and for each power the performance
case, `reso-sweep-<power>.wav` (`audition/resoSweep.mjs`): `acid-saw` on
sixteen A1 sixteenths a bar at 128 BPM and velocity 0.8, its cutoff held
at 500 Hz (the envelope's amount 0), while a song lane takes the Reso
knob's travel from its floor to its top and back over 4 bars.
`--listen tunables` renders windsor#574's and windsor#577's sets as before.
The files went to `~/Desktop/acid-tunables/`, never into the repository;
windsor#577's renders moved to its `before-makeup/` folder (its
`LADDER_MIX_GAIN-2.6.wav` is the song as windsor#577 shipped it). The
files were rendered again with the drive-off patches. Levels as rendered:

| power | gain at the top | song, RMS per part (saw / square / `acid-accent`), dBFS | sweep RMS, dBFS | sweep, 100 ms windows: range, floor, top |
|---|---|---|---|---|
| 0 | 0 dB | −29.0 / −26.8 / −28.5 | −24.3 | **11.3 dB**, −18.3, −29.1 dBFS |
| 0.35 | +8.7 dB | −21.2 / −18.9 / −20.5 | −19.2 | 3.5 dB, −17.7, −20.4 dBFS |
| **0.5** | **+12.4 dB** | **−17.9 / −15.6 / −17.1** | **−16.7** | **1.4 dB**, −17.4, −16.7 dBFS |
| 0.7 | +17.4 dB | −13.5 / −11.0 / −12.5 | −13.0 | 5.9 dB, −17.1, −11.7 dBFS |

At power 0 the sweep loses 10.8 dB from the floor to the top; at the
shipped 0.5 its level stays within 1.4 dB over the whole sweep, 9.9 dB
narrower, with the top 0.7 dB over the floor. At a 500 Hz cutoff the
circuit's own loss is far less than 1 / (1 + k)'s 24.9 dB (the feedback's
high-pass returns the bass under it, and the output mix adds its share),
so half the 1 / (1 + k) loss in dB, 12.4, is about all of this cutoff's.
Power 0.35 leaves a 2.7 dB fall; 0.7 overshoots, the top 5.4 dB over the
floor. The song files share the shipped volumes, so the power-0 file is
the circuit's level. The song file peaks at −3.0 dBFS at the shipped
power and at +1.5 dBFS at 0.7, as rendered.

**Cost**, on an Apple M1 under Node 24.21.0, the machine shared with other
sessions (load average 2.8–4.1). `ladderBench.mjs`, the ladder alone at
k 16.5 with the mix and the makeup at the top's (`--makeup` defaults to
√17.5; `bundle.mjs`'s `candidate` sets it), twelve interleaved pairs of
runs of `--seconds 20` against origin/main's bundle, three readings each,
median [range] ns a sample: the shipped 1× candidate **244.9 [238.3–275.1]
before and 248.1 [239.3–275.2] after, +1.3 %**; the 2× candidate 380.5 →
387.2, +1.8 %. `bench.mjs . <origin/main root> --rounds 20 --seconds 2
--beforeAcid 1`, eight held `pad-drift` voices, Acid at Reso 9, four runs,
ns per voice-sample and against the same bundle's Off (median [IQR]):

| variant | run 1 | | run 2 | | run 3 | | run 4 | |
|---|---|---|---|---|---|---|---|---|
| before Off | 25.01 | | 25.19 | | 24.96 | | 25.31 | |
| before LP 12 | 27.85 | +2.74 [2.62, 2.91] | 27.89 | +2.64 [2.29, 2.94] | 28.27 | +2.82 [2.71, 3.13] | 28.07 | +2.86 [2.62, 3.34] |
| before BP 12 | 27.87 | +2.79 [2.32, 3.01] | 28.02 | +2.79 [2.29, 2.90] | 28.14 | +2.99 [2.75, 3.32] | 28.05 | +2.81 [2.42, 3.42] |
| before LP 24 | 31.18 | +6.17 [5.85, 6.38] | 31.43 | +6.01 [5.63, 6.49] | 31.28 | +6.26 [6.18, 7.17] | 31.28 | +5.97 [5.54, 6.33] |
| before Formant | 33.59 | +8.64 [8.24, 8.76] | 33.56 | +8.31 [7.85, 8.53] | 34.05 | +8.90 [8.58, 10.09] | 33.68 | +8.46 [8.11, 8.63] |
| before Acid 1×4 | 269.11 | +243.79 [241.90, 247.51] | 270.05 | +244.11 [242.31, 246.09] | 273.92 | +248.71 [244.61, 253.34] | 270.36 | +245.34 [243.82, 247.80] |
| engine Off | 24.99 | | 25.08 | | 25.27 | | 25.10 | |
| engine LP 12 | 27.85 | +2.85 [2.75, 2.91] | 27.98 | +3.07 [2.77, 3.53] | 28.63 | +2.80 [2.55, 3.40] | 27.90 | +2.76 [2.62, 2.85] |
| engine BP 12 | 27.91 | +2.95 [2.81, 3.53] | 28.00 | +2.95 [2.72, 3.24] | 28.44 | +2.87 [2.18, 3.46] | 28.12 | +2.87 [2.71, 3.16] |
| engine LP 24 | 31.83 | +6.41 [6.25, 7.25] | 31.39 | +6.27 [6.10, 6.86] | 31.64 | +6.33 [5.71, 6.80] | 31.81 | +6.36 [6.08, 6.84] |
| engine Formant | 33.80 | +8.71 [8.54, 9.17] | 33.69 | +8.55 [8.33, 9.55] | 34.31 | +8.68 [8.04, 9.97] | 33.91 | +8.80 [8.29, 9.35] |
| **engine Acid 1×4** | **275.76** | +250.43 [244.28, 255.03] | **271.38** | +245.41 [243.12, 248.52] | **274.04** | +247.43 [244.70, 250.57] | **273.24** | +247.48 [245.06, 249.20] |
| engine Acid 2×3 | 399.25 | +372.45 [367.77, 380.40] | 408.13 | +383.12 [379.22, 388.33] | 397.46 | +372.34 [369.66, 376.48] | 399.64 | +374.68 [371.29, 377.64] |

An Acid voice costs 270.2 → 273.6 ns a voice-sample, the median of the
four runs, +1.3 % (the ladder's own share 244.7 → 247.5, +1.1 %); run by
run +2.5, +0.5, +0.0 and +1.1 %, the first run's inside its own IQR. Every
other mode is within 0.45 ns of before, inside the runs' spread.
