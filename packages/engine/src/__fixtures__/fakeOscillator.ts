/**
 * The graph stand-in's one source node (#642), beside `fakeAudioNodes.ts`.
 * Node-only, like the rest of this directory.
 */
import type { FakeHost } from './fakeAudioNodes';
import { BLOCK, FakeNode, FakeParam } from './fakeAudioNodes';

/** Points the normaliser samples one period at, as an implementation's wavetable would. */
const NORMALISE_POINTS = 4096;

/**
 * `createPeriodicWave`'s result (#695): the Fourier series the spec defines,
 * `x(φ) = Σₖ real[k]·cos(kφ) + imag[k]·sin(kφ)` for k ≥ 1 (the DC terms are
 * ignored), scaled so its peak is 1 unless `disableNormalization` is set.
 */
export class FakePeriodicWave {
  private readonly scale: number;

  constructor(
    readonly real: Float32Array,
    readonly imag: Float32Array,
    readonly disableNormalization = false,
  ) {
    let peak = 0;
    for (let i = 0; i < NORMALISE_POINTS; i++) {
      peak = Math.max(peak, Math.abs(this.series((2 * Math.PI * i) / NORMALISE_POINTS)));
    }
    this.scale = disableNormalization || peak === 0 ? 1 : 1 / peak;
  }

  /** The wave's value at phase `phi` radians. */
  at(phi: number): number {
    return this.scale * this.series(phi);
  }

  private series(phi: number): number {
    let sum = 0;
    const terms = Math.max(this.real.length, this.imag.length);
    for (let k = 1; k < terms; k++) {
      sum += (this.real[k] ?? 0) * Math.cos(k * phi) + (this.imag[k] ?? 0) * Math.sin(k * phi);
    }
    return sum;
  }
}

/**
 * An `OscillatorNode`, for LFOs: k-rate `frequency`, a running phase, and
 * silence outside `start()`..`stop()`. `type` 'sine' is `sin φ`;
 * `setPeriodicWave` makes it 'custom' and plays the wave's series at the same
 * phase, as the spec's oscillator does (#695). `stopped` records a `stop()`
 * call, since a running source is what keeps a disposed graph alive.
 */
export class FakeOscillator extends FakeNode {
  readonly kind = 'oscillator';
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  started = false;
  stopped = false;
  /** Context seconds the oscillator begins at: `start(when)`, as scheduled (#695). */
  startTime = 0;
  wave: FakePeriodicWave | null = null;
  private phase = 0;

  constructor(context: FakeHost) {
    super(context, 0, 1);
  }

  start(when = 0): void {
    this.started = true;
    this.startTime = when;
  }

  stop(): void {
    this.stopped = true;
  }

  setPeriodicWave(wave: FakePeriodicWave): void {
    this.wave = wave;
    this.type = 'custom';
  }

  /**
   * `frequency` is a-rate: its value plus any connected node, per sample (a
   * shared `ConstantSourceNode` drives a quadrature pair, #695). Silent, with
   * the phase held at 0, before `startTime`.
   */
  protected render(block: number): Float32Array[][] {
    const out = new Float32Array(BLOCK);
    if (!this.started || this.stopped) return [[out]];
    if (this.type !== 'sine' && this.type !== 'custom') {
      throw new Error(`fake OscillatorNode does not model type "${this.type}"`);
    }
    const wave = this.type === 'custom' ? this.wave : null;
    const hz = this.frequency.valuesAt(block);
    const rate = this.context.sampleRate;
    for (let i = 0; i < BLOCK; i++) {
      if ((block * BLOCK + i) / rate < this.startTime) continue;
      out[i] = wave ? wave.at(this.phase) : Math.sin(this.phase);
      this.phase += (2 * Math.PI * (hz[i] ?? 0)) / rate;
    }
    return [[out]];
  }
}

/** A `ConstantSourceNode`: its a-rate `offset`, per sample, between `start()` and `stop()` (#695). */
export class FakeConstantSource extends FakeNode {
  readonly kind = 'constant';
  readonly offset = new FakeParam(1);
  started = false;
  stopped = false;
  startTime = 0;

  constructor(context: FakeHost) {
    super(context, 0, 1);
  }

  start(when = 0): void {
    this.started = true;
    this.startTime = when;
  }

  stop(): void {
    this.stopped = true;
  }

  protected render(block: number): Float32Array[][] {
    if (!this.started || this.stopped) return [[new Float32Array(BLOCK)]];
    return [[this.offset.valuesAt(block)]];
  }
}
