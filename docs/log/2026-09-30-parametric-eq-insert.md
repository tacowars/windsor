# The Parametric EQ insert

- **Date:** 2026-09-30
- **Status:** accepted (tacowars, 2026-09-30)
- **Links:** mockup `docs/research/2026-09-30-parametric-eq/mockup.html` ·
  the issues are listed at the end

## Context

Windsor has no EQ beyond each strip's fixed low cut. Mixing a song means
cutting lows off pads, notching a ringing partial, lifting a lead's
presence and rolling off the top, on many part strips at once. tacowars
asked for a plain, high-quality, transparent parametric EQ for this: points
placed on a curve, each with a frequency, a gain and a Q, and nothing more
elaborate (no dynamic bands, no envelope followers).

tacowars reviewed the mockup, a working card at the rack's height, and
accepted it with every recommendation in its questions.

## Decision

1. **A new insert kind, Parametric EQ (`eq`),** usable on any part strip,
   the master and the send buses. It sits in a new **EQ** group at the top
   of the add picker. The rail reads "Parametric EQ".
2. **Eight bands.** Each has an on switch, a type, a slope, a frequency, a
   gain and a Q:
   - types: Low cut, Low shelf, Bell, Notch, High shelf, High cut;
   - slope, for the cuts only: 6, 12, 24 or 48 dB/oct (6 has no Q);
   - frequency 10 Hz – 22 kHz, held below Nyquist;
   - gain −24 – +24 dB, for the bell and the shelves only;
   - Q 0.10 – 18.0: the bandwidth of a bell or notch, the knee of a shelf,
     the resonance of a cut. 0.71 is every default band's Q; a bell added by
     double-clicking the curve starts at Q 1.
3. **Global controls:** Scale (0 – 200 %, multiplies every bell and shelf
   gain), Output (−24 – +24 dB, after the bands) and the rail's Enabled.
4. **A new EQ is flat:** 1 Low cut 30 Hz 12 dB (off), 2 Low shelf 100 Hz,
   3 Bell 250 Hz, 4 Bell 800 Hz, 5 Bell 2.5 kHz, 6 Bell 6 kHz, 7 High shelf
   10 kHz (bands 2–7 on at 0 dB), 8 High cut 18 kHz 12 dB (off).
5. **Stereo only.** Both channels share one curve. A per-band Stereo / Mid /
   Side choice may come later as an additive field. Q never changes with
   gain: the curve follows the knobs exactly.
6. **The sound engine.** One AudioWorklet per EQ, stereo, zero latency, no
   oversampling (a linear filter creates nothing to alias).
   - Bells and cuts use matched second-order sections, which keep the
     analog prototype's shape up to Nyquist. The formulas come from
     M. Vicanek, *Matched Second Order Digital Filters* (2016,
     `https://vicanek.de/articles/BiquadFits.pdf`). Shelves and the notch
     use the prewarped bilinear form unless the measurement in the first
     ticket shows an audible error; that ticket records the numbers.
   - 12 dB cuts are one section at the band's Q. 24 and 48 dB cuts are
     Butterworth cascades whose last section is scaled by the band's Q over
     0.71, so 0.71 is flat and more Q adds a bump at the corner.
   - Frequency, gain and Q glide on a short one-pole (log for frequency
     and Q). Coefficients refresh every 16 samples while a value moves and
     not at all once it settles. A change of type, slope or on switch
     crossfades the band against its own input, so nothing clicks.
   - Transposed direct form II with 64-bit state, with tiny state values
     flushed to zero.
   - Off and flat bands are skipped. A flat EQ copies input to output, bit
     for bit. Silent input with settled state gives silence without
     filtering.
7. **One coefficient module draws and plays.** A pure module under
   `inserts/` designs the coefficients and computes the digital magnitude
   response. The worklet filters with it and the console draws the curve
   from it, through the engine's index.
8. **The console card** is the mockup's layout, a single page at the rack's
   196 px: a band row over the curve, the selected band's panel (Type,
   Slope, Freq, Gain, Q, Listen on drag) and a Scale / Output column. The
   gestures are the mockup's "How you use it" list. The selected band, the
   ±12 / ±24 view range and the Listen switch are session view state.
9. **Spectrum and Listen.** The card shows the EQ's output spectrum behind
   the curve, through an analyser tap the engine opens only while the card
   is on screen. While a point is held with Listen on, the EQ plays only
   that band's range as a band-pass. Neither is saved.
10. **The song format gains one kind,**
    `{ kind: 'eq', enabled, scale, output, bands: [8 × { on, type, slope, freq, gain, q }] }`.
    It is additive, so `ARRANGEMENT_VERSION` does not change.

## Consequences

- Every EQ is one more worklet node. Its idle cost across 16 strips is
  measured on the load meter and recorded with the first ticket.
- The engine's `InsertStage` gains two optional extras for the spectrum
  and Listen, beside the compressor's `reduction`.

## Issues

- windsor#198: the engine insert, its worklet and coefficient module
- windsor#199: the console card, its curve and gestures
- windsor#200: the output spectrum and Listen on drag
