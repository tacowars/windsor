/**
 * The graph stand-in's shaper node (#641, #647), beside `fakeAudioNodes.ts`.
 * Node-only, like the rest of this directory.
 */
import { BLOCK, FakeNode } from './fakeAudioNodes';

/**
 * The spec's `WaveShaperNode` curve lookup: x in [-1, 1] maps linearly onto
 * the curve's indices, linearly interpolated, and anything outside reads the
 * end value. `oversample` is recorded and not modelled — the fake runs at the
 * base rate, so aliasing (what oversampling reduces) is not what it tests.
 */
export class FakeWaveShaper extends FakeNode {
  readonly kind = 'waveshaper';
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';

  protected render(block: number): Float32Array[][] {
    const channels = this.gather(block);
    const curve = this.curve;
    if (!curve || curve.length === 0) return [channels];
    const last = curve.length - 1;
    for (const channel of channels) {
      for (let i = 0; i < BLOCK; i++) {
        const x = channel[i] ?? 0;
        const v = (last * (x + 1)) / 2;
        if (v <= 0) channel[i] = curve[0] ?? 0;
        else if (v >= last) channel[i] = curve[last] ?? 0;
        else {
          const k = Math.floor(v);
          const f = v - k;
          channel[i] = (1 - f) * (curve[k] ?? 0) + f * (curve[k + 1] ?? 0);
        }
      }
    }
    return [channels];
  }
}
