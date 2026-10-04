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
aliasing and the convergence, are the last section, "The shipped filter".

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
