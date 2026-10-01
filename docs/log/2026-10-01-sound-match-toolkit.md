# A sound-match toolkit measures, compares and fits patches to recordings

2026-10-01 · windsor#282.

The kick fit (`docs/research/2026-09-30-kick-fit/`) showed that measuring a
render against a recording and searching a patch's numbers works, but its
scripts knew only kicks: zero crossings, a `build()` per machine and
Nelder–Mead. `scripts/sound-match/` is the general version, for the 808 and
909 reference set and whatever follows. Its manual is
`scripts/sound-match/README.md`. tacowars's ear stays the final judge; the
toolkit only says where a render differs and in which direction.

1. **Python for analysis and fitting, one Node renderer.** `render.mjs` runs
   the shipped `worklet/generated/fm-processor.js`, as the worklet harness
   does. Its server mode (JSON lines in, float32 out) keeps one Node process
   for a whole fit, since Node's start-up dominates a one-shot render
   (measured in `docs/research/2026-10-01-sound-match-throughput/`).
2. **numpy, scipy, matplotlib and `cma`, nothing heavier.** No torch,
   librosa or auraloss: the multi-resolution STFT loss is a few lines of
   numpy. No CLAP or OpenL3 embeddings: they are large, trained on general
   audio, and blind to the differences that matter here (a 2 dB click, a
   lopsided half-cycle). All four are BSD-style and AGPL-compatible.
3. **Noise is seeded only in the harness.** Every render passes
   `processorOptions.seed`; live playback keeps drawing from `Math.random`
   (`worklet/fm/prng.ts`), unchanged. A render that depends on the seed is
   decided from the patch's structure (a Noise or `phaseFree` operator,
   whatever its level, so a fit that raises a silent noise level stays
   seeded) or else by comparing two seeds sample for sample. It is scored as
   the mean over N seeds (default 4), and the report gives the spread. A
   fit does not chase one noise draw.
   (windsor#299: an S&H or Drift LFO or a non-zero `panRandom` counts as structural too, a fitted path that controls a random source keeps every seed for the whole fit, and a spec's `"seeds"` or `--seeds` forces the count.)
4. **Both sides are aligned by the same rule and peak-normalised.** The
   onset is the first sample above a threshold relative to the peak, less a
   lead (default −40 dB, 0.05 ms; the 909 pack wants −6 dB and 1.5 ms for
   its near-silent lead-in). The candidate uses the reference's rule unless
   told otherwise, and is zero-padded when its onset is closer to the start
   than the lead. The packs are normalised per voice, so absolute level
   carries no information.
5. **Measurements are over time and read per cycle where the sound is
   tonal.** The harmonic profile resamples each cycle to a fixed length and
   FFTs it. A plain resample of a sweeping, decaying cycle leaks the
   fundamental into every harmonic (a symmetric render read H2 at −25 dB),
   so the resampling grid follows the sweep and the level's decay is undone
   across the cycle, both at the rates the neighbouring cycles show; the
   same render then reads H2 below −40 dB. The negative half-cycle is
   compared with the positive halves on both sides of it, so decay alone
   does not read as asymmetry. The pitch is a whole cycle's frequency
   stepped per half-cycle, so an asymmetric wave does not alternate.
6. **"The body" is the reference's.** It runs from 5 ms to the reference's
   last cycle within 6 dB of its loudest, and the candidate is summarised
   over the same span.
7. **Tonal or noise-like is decided from the reference.** Spectral
   flatness over 5–150 ms below −25 dB makes the pitch and harmonic scores
   apply. A spec or `--tonal` can force it.
8. **Five scores, reported separately, plus a weighted total.** STFT loss,
   band envelopes, harmonics, pitch, and the early waveform MSE with a lag
   search, kept because no magnitude spectrum sees polarity or where a click
   lands. The default weights put each term on the same order at a typical
   kick mismatch; a spec overrides them.
9. **Structure is fixed by the spec; the optimizer moves numbers.** A spec
   names JSON paths into the patch with bounds and linear or log scale, and
   one or more references each with its note, velocity, gate and weight.
   CMA-ES is the default, Nelder–Mead the alternative. The start patch is
   scored first and kept unless beaten. The budget counts that evaluation and
   is never exceeded: a remainder smaller than a CMA population evaluates
   that many candidates and does not update the search.
10. **Nothing derived from a sample enters the repository.** References are
    read in place; spec paths expand `$VARS` so a spec names no machine's
    folders. Every output defaults to `<tmp>/sound-match/`. The scripts set
    `sys.dont_write_bytecode` rather than adding a `.gitignore` entry for
    `__pycache__`.
11. **Copied, not imported, from the kick fit.** The render harness and the
    ideas of `fit.cyc` and `wfit.wscore` are rewritten here; nothing imports
    `docs/research/2026-09-30-kick-fit/`.
