/**
 * Fractional delay storage, allocated once. Tested through retroReverbDsp.test.ts.
 * Samples cross its calls in fields, never as arguments or results: V8 boxes a
 * double passed to or returned from a call it does not inline (worklet rule 2,
 * `inserts/retroReverbAllocation.test.ts`). `read` takes `delay` and leaves its
 * sample in `output`; `write` stores `input`. Each double field is first written
 * as one (NaN), so it never changes representation (rule 7).
 */
class RetroDelay {
  buffer: Float32Array;
  head: number;
  /** The read's delay in samples, set before `read`. */
  delay: number;
  /** The last read's sample. */
  output: number;
  /** The sample `write` stores. */
  input: number;

  constructor(capacity: number) {
    this.buffer = new Float32Array(Math.ceil(capacity) + 2);
    this.head = 0;
    this.delay = this.output = this.input = NaN;
    this.delay = this.output = this.input = 0;
  }

  read(): void {
    const length = this.buffer.length;
    let position = this.head - Math.max(1, Math.min(length - 2, this.delay));
    if (position < 0) position += length;
    // A delay a hair over 1 at head 1 (Drift's detune near zero) rounds `position` up to `length`.
    if (position >= length) position -= length;
    const index = Math.floor(position);
    const next = index + 1 === length ? 0 : index + 1;
    this.output =
      this.buffer[index] + (position - index) * (this.buffer[next] - this.buffer[index]);
  }

  write(): void {
    this.buffer[this.head] = this.input;
    if (++this.head === this.buffer.length) this.head = 0;
  }
}

export { RetroDelay };
