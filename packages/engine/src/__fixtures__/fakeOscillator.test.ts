/**
 * The fake oscillator's `PeriodicWave` path (#695). The ensemble's phase-lock
 * fixtures are only as good as this: a cosine wave must render as a cosine,
 * in quadrature with the sine at the same phase, through a rate change.
 */
import { describe, expect, it } from 'vitest';

import { BLOCK } from './fakeAudioNodes';
import { FakeContext, renderGraph } from './fakeAudioContext';
import type { FakeOscillator } from './fakeOscillator';

const HZ = 3;
const LATER_HZ = 7;
const SECONDS = 1;

function capture(osc: FakeOscillator, context: FakeContext, onBlock?: (b: number) => void) {
  const [out] = renderGraph(context, SECONDS, [osc], onBlock);
  if (!out) throw new Error('no capture');
  return out.left;
}

function wave(context: FakeContext, real: number[], imag: number[], raw = true): FakeOscillator {
  const osc = context.createOscillator();
  osc.setPeriodicWave(
    context.createPeriodicWave(real, imag, { disableNormalization: raw }) as never,
  );
  osc.frequency.value = HZ;
  osc.start();
  return osc;
}

describe('FakeOscillator with a PeriodicWave', () => {
  it('renders real[1] = 1 as a cosine and imag[1] = 1 as the built-in sine', () => {
    const context = new FakeContext();
    const cos = capture(wave(context, [0, 1], [0, 0]), context);
    const sin = capture(wave(context, [0, 0], [0, 1]), context);
    const builtIn = context.createOscillator();
    builtIn.frequency.value = HZ;
    builtIn.start();
    const plain = capture(builtIn, context);
    for (let i = 0; i < cos.length; i += 97) {
      const phase = (2 * Math.PI * HZ * i) / context.sampleRate;
      expect(cos[i]).toBeCloseTo(Math.cos(phase), 5);
      expect(sin[i]).toBeCloseTo(plain[i]!, 6);
    }
    expect(cos[0]).toBeCloseTo(1, 9);
  });

  it('normalises the series to a peak of 1 unless told not to', () => {
    const context = new FakeContext();
    const scaled = capture(wave(context, [0, 3], [0, 0], false), context);
    const raw = capture(wave(context, [0, 3], [0, 0], true), context);
    expect(Math.max(...scaled)).toBeCloseTo(1, 5);
    expect(Math.max(...raw)).toBeCloseTo(3, 5);
  });

  it('keeps a sine and a cosine in quadrature through a rate change', () => {
    const context = new FakeContext();
    const sinOsc = wave(context, [0, 0], [0, 1]);
    const cosOsc = wave(context, [0, 1], [0, 0]);
    const change = Math.round((SECONDS * context.sampleRate) / BLOCK / 3);
    const onBlock = (b: number): void => {
      if (b !== change) return;
      sinOsc.frequency.value = LATER_HZ;
      cosOsc.frequency.value = LATER_HZ;
    };
    const [s, c] = renderGraph(context, SECONDS, [sinOsc, cosOsc], onBlock);
    // sin² + cos² = 1 at every sample only if the two share one phase.
    s!.left.forEach((v, i) => expect(v * v + c!.left[i]! ** 2).toBeCloseTo(1, 6));
    expect(sinOsc.type).toBe('custom');
  });

  it('refuses a series with mismatched or too few terms, as the spec does', () => {
    const context = new FakeContext();
    expect(() => context.createPeriodicWave([0, 1], [0])).toThrow();
    expect(() => context.createPeriodicWave([0], [0])).toThrow();
  });
});
