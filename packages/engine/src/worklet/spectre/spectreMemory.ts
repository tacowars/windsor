/**
 * One channel's band delays (record `2026-10-16-spectre-insert`): a ring of
 * whole spectral frames, each band's complex value at its own slot, so a band
 * delayed by d frames reads the frame written d frames ago.
 *
 * Per band k, with input x (the analysis after the input modulation), gain
 * g, delay d and feedback f:
 *
 * - d > 0: the band's output y is the ring's value d frames back, and the
 *   ring takes `g·x + f·y` now: a feedback delay per band, its repeats d
 *   frames apart, the gain at the loop's door.
 * - d = 0: the output is `g·x` and the ring takes it, so feedback needs a
 *   delay to act.
 *
 * Freeze glides `freeze` from 0 to 1: the door closes (g · (1 − freeze)).
 * In Hold (`lift` 1) the feedback opens (f + freeze · (1 − f)), so whatever
 * the ring holds loops unchanged; in Carve (`lift` 0, record
 * `2026-10-17-spectre-drawn-cells` decision 7) the drawn feedback stays, so a
 * band drawn below full decays away while a band at full holds. A band at
 * d = 0 has no loop to hold, and passes nothing while frozen.
 *
 * The ring is sized at construction for `SPECTRE_DSP.maxSeconds` at the
 * smallest hop the processor can reach; `resize` lays it out for a frame size
 * and hop, from silence. `loudest` is the largest magnitude a frame wrote,
 * for the sleep.
 *
 * Invariants: nothing allocates after construction; the bands arrive in and
 * leave through the FFT's `re`/`im` (worklet rule 2). Pinned by
 * `inserts/spectreDsp.test.ts` (one band's echo at its delay, Freeze's hold).
 */
class SpectreMemory {
  /** Frames, each `stride` floats: band k's re at 2k, im at 2k + 1. */
  readonly ring: Float32Array;
  stride: number;
  /** Whole frames the ring holds at the current stride. */
  frames: number;
  /** The frame the next write goes to. */
  at: number;
  /** 0 open, 1 held; the DSP glides it. */
  freeze: number;
  /** How far Freeze lifts the feedback to full: 1 Hold, 0 Carve. */
  lift: number;
  loudest: number;

  constructor(capacity: number) {
    this.freeze = this.lift = this.loudest = NaN;
    this.ring = new Float32Array(capacity);
    this.stride = 2;
    this.frames = capacity >> 1;
    this.at = 0;
    this.freeze = 0;
    this.lift = 1;
    this.loudest = 0;
  }

  /** Frames of `bands` bands from now on, `frames` of them (the ring's length over the stride), from silence. */
  resize(bands: number, frames: number): void {
    this.stride = 2 * bands;
    this.frames = frames;
    this.clear();
  }

  /** The frames in use back to silence; the ring past them is never read at this stride. */
  clear(): void {
    this.ring.fill(0, 0, this.frames * this.stride);
    this.at = 0;
    this.loudest = 0;
  }

  /** One frame of `bands` bands through their delays, in place in `re`/`im`. */
  run(
    re: Float64Array,
    im: Float64Array,
    gains: Float64Array,
    delays: Int32Array,
    feedbacks: Float64Array,
  ): void {
    const ring = this.ring,
      stride = this.stride,
      frames = this.frames,
      write = this.at * stride,
      bands = stride >> 1;
    const hold = this.freeze,
      open = 1 - hold,
      raise = hold * this.lift;
    let loudest = 0;
    for (let k = 0; k < bands; k++) {
      const g = gains[k] * open,
        d = delays[k],
        w = write + 2 * k;
      const xr = re[k] * g,
        xi = im[k] * g;
      if (d === 0) {
        ring[w] = xr;
        ring[w + 1] = xi;
        re[k] = xr;
        im[k] = xi;
      } else {
        let from = this.at - d;
        if (from < 0) from += frames;
        const r = from * stride + 2 * k;
        const yr = ring[r],
          yi = ring[r + 1];
        const f = feedbacks[k] + raise * (1 - feedbacks[k]);
        const wr = xr + f * yr,
          wi = xi + f * yi;
        ring[w] = wr;
        ring[w + 1] = wi;
        re[k] = yr;
        im[k] = yi;
        const size = (wr < 0 ? -wr : wr) + (wi < 0 ? -wi : wi);
        if (size > loudest) loudest = size;
        continue;
      }
      const size = (xr < 0 ? -xr : xr) + (xi < 0 ? -xi : xi);
      if (size > loudest) loudest = size;
    }
    this.loudest = loudest;
    const next = this.at + 1;
    this.at = next >= frames ? 0 : next;
  }
}

export { SpectreMemory };
