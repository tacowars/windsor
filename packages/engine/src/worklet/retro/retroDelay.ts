/** Fractional delay storage, allocated once. Tested through retroReverbDsp.test.ts. */
class RetroDelay {
  buffer: Float32Array;
  head: number;

  constructor(capacity: number) {
    this.buffer = new Float32Array(Math.ceil(capacity) + 2);
    this.head = 0;
  }

  read(delay: number): number {
    const length = this.buffer.length;
    let position = this.head - Math.max(1, Math.min(length - 2, delay));
    if (position < 0) position += length;
    const index = Math.floor(position);
    const next = index + 1 === length ? 0 : index + 1;
    return this.buffer[index] + (position - index) * (this.buffer[next] - this.buffer[index]);
  }

  write(value: number): void {
    this.buffer[this.head] = value;
    if (++this.head === this.buffer.length) this.head = 0;
  }
}

export { RetroDelay };
