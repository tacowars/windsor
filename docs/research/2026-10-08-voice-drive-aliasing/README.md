# The voice drive's aliasing, measured, and what each fix buys

The voice drive (`worklet/fm/voiceDrive.ts`, windsor#300) runs its shapers
once per host sample with no oversampling. Decision 4 of
`docs/log/2026-10-01-voice-drive-stage.md` records "`hard` and `fold` alias,
by design" but not why, and `soft`, which most driven patches use, aliases
too. tacowars asked for the aliasing of `soft`, `hard` and `fold` to be
measured on a bright input across the keyboard, beside the fixes that could
remove it, so that the choice rests on numbers. Golden changes are accepted.

**In short.** On a bright input driven into its knee, today's drive puts its
aliasing about 25–29 dB below the note, A-weighted (fold 17 dB). That is
audible as inharmonic grit. The candidate that keeps the tone and buys
about 30 dB is **2× oversampling through a linear-phase halfband FIR, with
first-order antiderivative anti-aliasing (ADAA) at the 2× rate**. Its cost
is the obstacle: about 66 ns per driven voice-sample for `hard`, and 179 ns
for `soft`, where the portable logarithm in soft's antiderivative is
about 112 of those. A voice costs about 40 ns on the same machine. The
library's pitched patches drive so lightly today (peak operand 0.2–0.3)
that they barely alias at all; the problem is a patch that turns the drive
up on a bright sound.

## Machine and method

| | |
|---|---|
| Machine | cloud container, Intel Xeon @ 2.80 GHz, 4 vCPU, Linux 6.18 |
| Runtime | Node v22.22.0 (the container has no Node 24, `.nvmrc`'s), `npx tsx` 4.20.3, V8 JIT |
| Load | 1-minute load average 0.4–0.9 through the cost runs |
| Browser | none: no reading here is from Chrome or an `AudioWorkletGlobalScope` |

These are one machine's readings in Node (CLAUDE.md invariant 5). The
aliasing readings are arithmetic and do not depend on the machine; the
costs do.

**The input is the engine's own.** `bench.mts` renders one held note through
the worklet harness (`fm-processor.js`), drive and filter off, centre pan, on
fixed-frequency operators so the fundamental is exact, and normalises the
left channel to peak 1. A drive's gain is then the shaper's peak operand: 1
is a light touch (soft barely bends), 3 is soft's full knee, 8 is heavy.
Each shape is run over that capture by `shapers.mts`. As a check, the engine
rendered with each shape on matches `naive` on the capture to within
2·10⁻⁷ (float32 rounding) at C2, C5 and F#7 for all three inputs, so the
capture is what the drive sees.

- **Inputs:** `saw` (the band-limited Saw table, tone 1), `square`, and
  `fm` (a sine carrier with a sine modulator at ratio 1, level 0.5: few
  harmonics low, bright high).
- **Keyboard:** C1 to C8 every half octave, 15 notes.
- **Drives:** peak operand 1, 3 and 8 at bias 0, and soft at 3 with bias 0.3.
- **Reading (`spectrum.mts`):** a 65 536-point Blackman–Harris spectrum of
  the steady tone. Bins within ±6 of a harmonic are the note; every other
  bin in 20 Hz – 20 kHz is aliasing, since a static shaper on a periodic
  input makes nothing else. The figure is the **alias-to-signal ratio,
  A-weighted** (both sides weighted), in dB: how loud the aliasing is next
  to the note. The input's own floor is read the same way.
- **Tone:** each harmonic below 16 kHz against the reference, the largest
  difference over harmonics within 40 dB of the strongest.

The methods:

| Method | What it is |
|---|---|
| `naive` | as shipped: one evaluation per host sample |
| `adaa1` | first-order ADAA at 1×: (F(u) − F(u₋₁)) / (u − u₋₁), the curve at the midpoint for a step under 10⁻⁶ |
| `os2` | 2× through a 47-tap Kaiser (β 8) halfband FIR, linear phase, 23 host samples of delay |
| `os2-adaa1` | the same 2×, with ADAA at the 2× rate |
| `os4` | two cascaded `os2` stages |
| `iir2` | 2× through a polyphase IIR halfband (two allpass chains, 8 sections, transition 0.04; the elliptic design of Laurent de Soras's HIIR, public domain/WTFPL) |
| `iir2-adaa1` | the IIR 2× with ADAA at 2× |
| `ref16` | the reference: 16× through four 191-tap β 12 halfbands |

The antiderivatives: hard's is x²/2 inside ±1 and |x| − ½ outside; fold's
is periodic (period 4, piecewise quadratic); soft's is x²/18 +
(4/3)·ln(1 + x²/3) inside ±3 and |x| − 3 + F(3) outside, so it needs a
logarithm. The worklet may not call `Math.log` (its bits differ between
arm64 and x64), so the cost bench runs `log2InPlace`, the portable log the
diode curve already uses.

`iirCheck.mts` measured both halfbands with a sine. The IIR's image sits
74 dB or more down up to 22 kHz, and its round trip is flat. The FIR's
image is 39 dB down at 20 kHz and 17 dB at 22 kHz, and its round trip is
0.2 dB down at 20 kHz and 2.4 dB at 22 kHz: a longer FIR would do better
near Nyquist.

## Aliasing

Median over the 15 notes, A-weighted alias-to-signal in dB (lower is
cleaner). The input's own floor has a median of −85 dB (saw and square)
and −90 dB (fm). Every reading, and the worst note of each, is printed
by `bench.mts`.

**Saw:**

| Shape | Operand | naive | adaa1 | os2 | os2-adaa1 | os4 | iir2 | iir2-adaa1 | ref16 |
|---|---|---|---|---|---|---|---|---|---|
| soft | 1 | −41.0 | −55.0 | −63.7 | −66.3 | −63.6 | −78.2 | −79.8 | −78.1 |
| soft | 3 | −28.9 | −42.9 | −47.5 | −59.4 | −57.7 | −56.7 | −73.1 | −79.5 |
| soft | 8 | −25.0 | −39.4 | −34.8 | −54.1 | −48.2 | −35.7 | −56.4 | −77.4 |
| soft, bias 0.3 | 3 | −28.9 | −42.8 | −47.1 | −59.3 | −57.6 | −57.1 | −73.4 | −76.7 |
| hard | 3 | −26.8 | −41.0 | −44.6 | −57.5 | −51.5 | −47.3 | −65.3 | −71.1 |
| hard | 8 | −24.4 | −39.1 | −32.9 | −52.7 | −44.2 | −33.6 | −54.2 | −63.4 |
| fold | 3 | −17.5 | −31.1 | −33.5 | −47.4 | −41.9 | −35.6 | −50.2 | −57.4 |
| fold | 8 | −18.6 | −28.5 | −21.3 | −35.3 | −33.0 | −19.0 | −37.8 | −45.8 |

The square reads within about 3 dB of the saw, except fold at operand 8,
which is about 5 dB worse. Hard and fold at operand 1 are left out: the
capture's sample peak is 1, so they barely engage at 1×, and an
oversampled method clips the band-limited signal's true peak between
samples, which is correct, not a defect.

**FM** (sparse harmonics at the bottom of the keyboard, bright at the top):

| Shape | Operand | naive | adaa1 | os2 | os2-adaa1 | os4 | iir2 | iir2-adaa1 | ref16 |
|---|---|---|---|---|---|---|---|---|---|
| soft | 3 | −67.0 | −74.6 | −90.0 | −90.0 | −90.0 | −90.0 | −90.1 | −90.5 |
| soft | 8 | −36.5 | −47.1 | −71.7 | −86.4 | −89.6 | −71.8 | −86.9 | −90.7 |
| hard | 3 | −40.9 | −53.0 | −54.1 | −74.5 | −66.4 | −54.1 | −74.5 | −88.1 |
| hard | 8 | −32.1 | −43.4 | −44.9 | −65.7 | −58.8 | −44.9 | −65.7 | −80.9 |
| fold | 3 | −32.5 | −44.5 | −45.6 | −66.1 | −58.0 | −45.6 | −66.1 | −81.9 |
| fold | 8 | −14.6 | −23.6 | −25.8 | −47.7 | −39.9 | −25.8 | −47.7 | −64.2 |

**Across the keyboard**, the saw at soft's knee (operand 3):

| Note | naive | adaa1 | os2-adaa1 | ref16 |
|---|---|---|---|---|
| C2 | −27.8 | −41.9 | −57.1 | −60.9 |
| C3 | −27.9 | −41.9 | −56.6 | −64.1 |
| C4 | −28.5 | −42.5 | −57.7 | −67.7 |
| C5 | −28.9 | −42.9 | −58.8 | −71.2 |
| C6 | −28.2 | −42.2 | −59.4 | −80.2 |
| C7 | −25.9 | −39.7 | −54.5 | −72.6 |
| C8 | −21.9 | −35.8 | −58.1 | −89.8 |

The saw's harmonics already reach Nyquist at every note, so any bend folds
at once: the aliasing is about the same at every note. On the FM input,
which has few harmonics low down, soft at 3 is clean (−87 dB) up to C4,
then reads −52 dB at C5, −30 at C6 and −15 at C7 as shipped. With
`os2-adaa1` it reads −93, −81 and −50 at those three notes. Above C7 the FM
input itself aliases (its sidebands pass Nyquist), and no drive fix can
help that.

## Tone

The largest harmonic difference from `ref16` below 16 kHz, dB, the worst
note:

| Input, shape, operand | naive | adaa1 | os2 | os2-adaa1 | os4 | iir2 | iir2-adaa1 |
|---|---|---|---|---|---|---|---|
| saw, soft, 3 | 0.01 | 3.11 | 0.05 | 0.69 | 0.05 | 1.10 | 1.33 |
| saw, soft, 8 | 0.06 | 2.79 | 0.34 | 0.74 | 0.34 | 12.86 | 11.96 |
| saw, hard, 3 | 0.05 | 3.16 | 0.33 | 0.71 | 0.31 | 1.16 | 1.47 |
| fm, soft, 3 | 2.17 | 3.20 | 0.96 | 0.74 | 0.66 | 11.52 | 10.41 |
| fm, hard, 8 | 3.53 | 5.98 | 1.47 | 1.27 | 0.89 | 9.95 | 13.78 |

- **ADAA dulls the top.** On a small signal it is the two-tap average
  (1 + z⁻¹)/2. At 1× that is −2.0 dB at 10 kHz, −6.0 at 16 kHz and −11.7
  at 20 kHz. At 2× it is −0.5, −1.3 and −2.0 dB at the same frequencies.
  These are computed, and they match the measured 5.98 and 1.24 dB at
  16 kHz.
- **The IIR changes the waveform.** The FIR is linear phase. The IIR
  halfband shifts each harmonic's phase before the shaper, so the shaper
  bends a differently shaped wave: a peakier saw clips sooner and comes out
  different. That is the 10–13 dB, and it is not a loss of level.
- **Fold at operand 8** differs from the reference by 4 to 50 dB under
  every method. It folds the wave several times, and the reference's own
  harmonics sit among strong aliasing, so the figure means little there.
- `naive`'s own error on the FM input is aliasing that lands on a harmonic
  bin.

## Cost

Median nanoseconds per voice-sample, 9 runs of 20 s of a saw at operand 3
(`cost.mts`). The first run, the warm-up, is included. Each method is a
standalone loop in the worklet's style: typed-array state, no allocation,
everything inline. A helper returning a double would box it and time the
heap instead, which the bench's first version did. Inside the voice kernel
the cost can differ, since the kernel is past V8's inlining budget (worklet
rule 2).

| Loop | ns | Added over `naive` |
|---|---|---|
| a voice, one saw, drive off (the harness render) | 38.9 | |
| the same voice, soft drive on (as shipped) | 46.4 | |
| `naive` soft | 2.7 | |
| `adaa1` hard | 11.0 | +8 |
| `adaa1` fold | 13.0 | +10 |
| `adaa1` soft, portable log | 59.8 | +57 |
| `adaa1` soft, `Math.log` (not allowed in the worklet) | 34.7 | +32 |
| `os2` soft | 67.6 | +65 |
| `os2-adaa1` hard | 68.9 | +66 |
| `os2-adaa1` soft, portable log | 181.3 | +179 |
| `os4` soft | 245.3 | +243 |
| `iir2` soft | 50.3 | +48 |
| `iir2-adaa1` hard | 62.2 | +59 |
| `iir2-adaa1` soft, portable log | 163.9 | +161 |

Soft's ADAA costs two portable logarithms per host sample at 2×. That
accounts for 112 of `os2-adaa1` soft's 179 ns, as the difference with
hard shows. A cheaper portable log, or another way to evaluate soft's
antiderivative to the precision ADAA needs, is the lever for soft. The IIR
is only about 25 % cheaper than the FIR here, because its 16 allpass
sections run in series.

At 48 kHz, 100 ns per voice-sample is 0.48 % of one core per voice on this
machine. Sixteen driven voices at `os2-adaa1` soft's 179 ns would take
about 14 % of the audio thread.

## How hard the library drives

`library.mts` renders each driven library patch at note 60, velocity 1, with
its drive and filter off, and reads the shaper's peak operand (gain × the
drive's input peak + |bias|):

| Patches | Peak operand |
|---|---|
| `fm-hat-open`, `fm-hat-closed`, `tr909-clap` | 11.0, 7.5, 4.5 |
| the kicks (`tr909-kick*`, `tr808-kick*`, `kick`) | 1.3 – 1.8 |
| the rest of the kit (toms, claps, snares, rims, cymbals, cowbells) | 0.4 – 1.3 |
| `horde-horn`, `bass-digital`, `drone-sqr`, `saw-arp` | 0.21 – 0.32 |

The pitched patches sit where soft is all but a straight line, so they
alias little today, and any fix changes their sound only by its delay and
its top-octave response. The heavy drivers are the hats and the 909 clap,
whose sources are noise-like, so their aliasing is heard as more noise.
Any change to the drive changes the render of all 38 driven patches, so
the goldens change.

## A side finding: the Saw oscillator's own floor

The capture is a plain Saw with no drive. It reads −36 dB A-weighted at C1,
about −50 to −55 dB through C#1–C2, −62 dB at C3 and −77 dB at C4. An exactly
summed band-limited saw reads −91 dB on the same meter. The energy is many
small components (the strongest −70 dBc), not a tone. The likely cause is
linear interpolation of the 2048-sample tables: the lowest mip holds 733
harmonics, and C1 sits at the top of its octave because `MIP_BASE_HZ`
(16.352) is a hair above C0. That is the oscillator, not the drive, and it
is its own ticket if wanted.

## Proposal

Ship **`os2-adaa1`** for `soft`, `hard` and `fold`: 2× through a
linear-phase halfband FIR, ADAA at the 2× rate.

- It removes about 30 dB of aliasing where the drive bends: saw at soft's
  knee −28.9 → −59.4 dB, heavy soft −25.0 → −54.1, hard −26.8 → −57.5,
  fold −17.5 → −47.4.
- It keeps the tone within about 1.3 dB of the alias-free reference below
  16 kHz (fold at operand 8 aside).
- The others fall short on the numbers. `adaa1` alone buys 14 dB and costs
  6 dB at 16 kHz. `os2` alone buys 16–19 dB at the knee and falls behind
  `adaa1` at heavy drive. `os4` is both worse and dearer. The IIR is
  cleanest (`iir2-adaa1`: −73 dB at soft's knee), but it reshapes the
  waveform the shaper sees (10–13 dB on some harmonics), is only about
  25 % cheaper, and so changes the drive's character, which is what this
  change is meant to preserve.

The implementation ticket should:

1. Make soft's antiderivative cheap, and read its cost against the 179 ns
   here.
2. Read the cost on the shipped bundle in Chrome.
3. Settle the FIR's length against its weak image rejection near Nyquist.
4. Measure `diode` and `tube`, which this note does not.
5. Weigh the 23-sample delay a driven voice gains against an undriven layer.
6. Refresh the goldens and say so.

## Reproduce

From the repository root:

```
npx tsx docs/research/2026-10-08-voice-drive-aliasing/bench.mts [results.json]
npx tsx docs/research/2026-10-08-voice-drive-aliasing/cost.mts [runs]
npx tsx docs/research/2026-10-08-voice-drive-aliasing/iirCheck.mts
npx tsx docs/research/2026-10-08-voice-drive-aliasing/library.mts
```

`bench.mts` takes about 5 minutes here, and writes every reading (about
1 MB) to the path it is given.
