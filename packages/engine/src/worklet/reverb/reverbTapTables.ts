/**
 * The plate's output taps (windsor#766): Windsor's own table, replacing
 * Dattorro's table 2. Import-free and scope-free: nothing here reads
 * `sampleRate`. The tank's sample loop reads every tap (`tank.ts`), and
 * `_applySize` (`delayLines.ts`) scales each time by Size, as table 2's were.
 *
 * Each tap is a delay in seconds at Size 1, read back from where its line is
 * written, linear between samples; the line it reads (4 to 11, the tank); and
 * its gain, full or three-quarters, with its sign. The first TAPS_PER_SIDE
 * sum to the left output, the rest to the right, each side's sorted by line
 * then time.
 *
 * How it was chosen (`docs/research/2026-10-12-plate-output-taps/`):
 * - **Twelve taps a side**, against seven before: twelve measured denser and
 *   kept the sides better than ten, for about a microsecond a quantum more.
 * - **Each output leads with its own input.** L's chain feeds the right loop
 *   (lines 8 to 11) and R's the left (4 to 7), windsor#763. Each output reads
 *   7 of its 12 taps, and the larger share of its |gain| (7 against 4 on the
 *   left, 6.75 against 4.25 on the right), from the half its own input feeds.
 * - **The lead zone.** A click entering a half reaches its first two lines at
 *   once (the first all-pass passes it straight on) and its last two a long
 *   line later. Every slot a click reaches inside 52 ms at Size 1 belongs to
 *   that half's own side, so the other output hears nothing of that input in
 *   the windows `main` held silent (50 ms at Size 1, 200 ms at Size 4). So
 *   lines 4 and 8 are read only by the side whose input they take.
 * - **Interleaved.** Past the lead zone each half's slots, in the order a
 *   click reaches them, are dealt to the other side and back in turn, so the
 *   two outputs read the loop at alternating points. All eight lines are read,
 *   each side reading seven of them: all but the other half's first all-pass.
 * - **Each owner's first tap** sits on its half's first all-pass within
 *   11.9 ms, so each side still hears its own input within 50 ms at Size 4.
 * - **Gains and signs** were chosen by a hill climb over captured tap signals
 *   (the output is linear in the gains): the least margin over early density,
 *   L/R correlation, the mono sum and windsor#763's side-lead and mirror
 *   cells at 48 and 44.1 kHz, and the T30 of Decay 2 s at Size 4, all against
 *   `main`; then each tap's time was moved in steps of 1.5 to 3 ms the same
 *   way, never past another tap.
 * - **Every tap lies inside 1 ms to 95 % of its line**, so at Size 0.05 and
 *   44.1 kHz it still reads two samples behind the write head, and the
 *   clamp in `_applySize` never binds at Size 1 (`mixer/reverbTaps.test.ts`).
 *
 * `mixer/reverbGolden.test.ts` pins the render; `__fixtures__/reverbHarness.ts`
 * reads TAP_TIME, TAP_LINE, TAP_GAIN and TAPS_PER_SIDE by their top-level names.
 */

/** Seconds at Size 1: twelve left, then twelve right. */
const TAP_TIME = [
  0.063893, 0.013135, 0.024148, 0.049371, 0.079806, 0.010071, 0.007901, 0.097009, 0.065061,
  0.002239, 0.040101, 0.050746, 0.002177, 0.012564, 0.016937, 0.116655, 0.019884, 0.027815,
  0.076755, 0.070474, 0.114526, 0.020705, 0.055304, 0.046873,
];
const TAP_LINE = [5, 6, 6, 7, 7, 8, 9, 9, 10, 11, 11, 11, 4, 5, 5, 5, 6, 7, 7, 9, 9, 10, 10, 11];
const TAP_GAIN = [
  1, -0.75, -0.75, 0.75, -0.75, -1, 1, -1, -1, 1, -1, -1, 0.75, -1, -1, 1, 1, -1, -1, 1, -0.75, 1,
  -0.75, -0.75,
];

/** The first TAPS_PER_SIDE taps sum to the left output, the rest to the right. */
const TAPS_PER_SIDE = 12;

/**
 * The trim on the tap sum, so a centred click's wet RMS over its first second
 * matches `main`'s (table 2 at 0.6), averaged in dB over Build 0, 0.5 and 1
 * in the default space at 48 kHz: every one within 0.12 dB.
 */
const OUTPUT_TRIM = 0.4694;

export { TAP_TIME, TAP_LINE, TAP_GAIN, TAPS_PER_SIDE, OUTPUT_TRIM };
