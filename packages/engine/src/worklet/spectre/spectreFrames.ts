/**
 * One channel's short-time framing (record `2026-10-16-spectre-insert`):
 * the input ring a frame is read from, and the overlap-add ring the
 * resynthesised frames sum into. Both are `size` samples, indexed by time
 * modulo `size`, so a frame taken at time t covers t − size + 1 to t and adds
 * into the same slots, and the output at t is the sum for t − size + 1, the
 * oldest slot, complete because every frame that covers it has been taken.
 *
 * - **Latency** is `size − 1` samples, fixed for a resolution. A second ring,
 *   the dry one, read at the same slot, is the input that much late: the dry
 *   signal the Mix and the switch read, so wet and dry stay aligned. It is
 *   separate so the wet path can restart from rest (`clearWet`, the analysis
 *   ring and the sums) while the dry plays on.
 * - `push` writes `input` and leaves the late input in `dry`; after any frame
 *   due at that sample, `emit` leaves the finished overlap-add sample in `wet`
 *   and clears its slot for reuse.
 * - `take` windows the current frame into the FFT's `frame`; `add` sums the
 *   FFT's `frame`, windowed again and scaled by the field `gain`, into the ring.
 *
 * Invariants: nothing allocates after construction and no double crosses a
 * call (samples in `input`, `dry`, `wet`; worklet rule 2). Pinned by
 * `inserts/spectreDsp.test.ts` (unity and latency at every resolution).
 */
class SpectreFrames {
  readonly inputs: Float64Array;
  readonly drys: Float64Array;
  readonly sums: Float64Array;
  size: number;
  mask: number;
  /** The slot the next sample is written to. */
  at: number;
  input: number;
  dry: number;
  wet: number;
  /** The overlap-add gain `add` applies, set with the resolution. */
  gain: number;

  constructor(capacity: number) {
    this.input = this.dry = this.wet = this.gain = NaN;
    this.inputs = new Float64Array(capacity);
    this.drys = new Float64Array(capacity);
    this.sums = new Float64Array(capacity);
    this.size = capacity;
    this.mask = capacity - 1;
    this.at = 0;
    this.input = this.dry = this.wet = 0;
    this.gain = 1;
  }

  /** Frames of `size` from now on, from silence. */
  resize(size: number): void {
    this.size = size;
    this.mask = size - 1;
    this.clear();
  }

  clear(): void {
    this.inputs.fill(0);
    this.drys.fill(0);
    this.sums.fill(0);
    this.at = 0;
  }

  /** The analysis and overlap-add rings back to silence: the wet path from rest, the dry kept. */
  clearWet(): void {
    this.inputs.fill(0);
    this.sums.fill(0);
  }

  /** `input` in; the input `size − 1` samples ago in `dry`; the finished sum in `wet`. */
  push(): void {
    const at = this.at,
      mask = this.mask;
    this.inputs[at] = this.input;
    this.drys[at] = this.input;
    const oldest = (at + 1) & mask;
    this.dry = this.drys[oldest];
    this.at = oldest;
  }

  /** Reads the finished overlap-add sample for the slot `push` just moved to, and clears it. */
  emit(): void {
    const at = this.at;
    this.wet = this.sums[at];
    this.sums[at] = 0;
  }

  /** The frame ending at the last pushed sample, times `window`, into `frame`. */
  take(frame: Float64Array, window: Float64Array): void {
    const n = this.size,
      mask = this.mask,
      start = this.at,
      inputs = this.inputs;
    for (let j = 0; j < n; j++) frame[j] = inputs[(start + j) & mask] * window[j];
  }

  /** `frame` times `window` and the field `gain`, summed into the slots of the frame `take` read. */
  add(frame: Float64Array, window: Float64Array): void {
    const gain = this.gain,
      n = this.size,
      mask = this.mask,
      start = this.at,
      sums = this.sums;
    for (let j = 0; j < n; j++) sums[(start + j) & mask] += frame[j] * window[j] * gain;
  }
}

export { SpectreFrames };
