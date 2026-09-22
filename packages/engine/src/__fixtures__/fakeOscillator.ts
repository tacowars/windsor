/**
 * The graph stand-in's one source node (#642), beside `fakeAudioNodes.ts`.
 * Node-only, like the rest of this directory.
 */
import type { FakeHost } from './fakeAudioNodes';
import { BLOCK, FakeNode, FakeParam } from './fakeAudioNodes';

/**
 * A sine `OscillatorNode`, for LFOs: k-rate `frequency`, a running phase, and
 * silence outside `start()`..`stop()`. `stopped` records a `stop()` call, since
 * a running source is what keeps a disposed graph alive.
 */
export class FakeOscillator extends FakeNode {
  readonly kind = 'oscillator';
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  started = false;
  stopped = false;
  private phase = 0;

  constructor(context: FakeHost) {
    super(context, 0, 1);
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  protected render(): Float32Array[][] {
    const out = new Float32Array(BLOCK);
    if (!this.started || this.stopped) return [[out]];
    const step = (2 * Math.PI * this.frequency.value) / this.context.sampleRate;
    for (let i = 0; i < BLOCK; i++) {
      out[i] = Math.sin(this.phase);
      this.phase += step;
    }
    return [[out]];
  }
}
