/**
 * Early (RV-1): what Early 1 adds to Early 0 is exactly the reflections. With Character 0 the wet
 * path is linear, so the difference of the two impulse responses is the taps alone: energy in a
 * short window at each tap's time after the pre-delay point (the converter's filters and the wet
 * tone spread each one over a millisecond or two), and nothing anywhere else, the tank included.
 */
import { expect, it } from 'vitest';
import { loadRetro, retroParams } from '../__fixtures__/retroReverbHarness';
import { RETRO_REVERB_DSP as C } from './retroReverbConstants';
import type { RetroReverbSpec } from './retroReverbSpec';

const RATE = 48000;
/** 320 ms in whole quanta: the taps, the windows and a long stretch after them. */
const FRAMES = 120 * 128;
const PRE_DELAY = 0.02;
/** Each tap's window, in seconds around its time: the filters' delay and ring. */
const BEFORE = 0.0005;
const AFTER = 0.0025;

function impulseResponse(spec: Partial<RetroReverbSpec>): Float32Array[] {
  const params = retroParams({ mix: 1, character: 0, tone: 9000, preDelay: PRE_DELAY, ...spec });
  const processor = loadRetro(RATE, params);
  const result = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
  const output = [new Float32Array(128), new Float32Array(128)];
  const input = new Float32Array(128);
  for (let frame = 0; frame < FRAMES; frame += 128) {
    input[0] = frame === 0 ? 0.5 : 0;
    processor.process([[input, input]], [output], params);
    for (let channel = 0; channel < 2; channel++) result[channel]!.set(output[channel]!, frame);
  }
  return result;
}

it('adds exactly the reflections: at each tap time after the pre-delay, and nothing after the last', () => {
  const without = impulseResponse({ early: 0 });
  const withEarly = impulseResponse({ early: 1 });
  const taps = [C.earlySecondsLeft, C.earlySecondsRight];
  for (let channel = 0; channel < 2; channel++) {
    const windows = taps[channel]!.map((t) => [
      Math.floor((PRE_DELAY + t - BEFORE) * RATE),
      Math.ceil((PRE_DELAY + t + AFTER) * RATE),
    ]);
    const inWindow = new Float64Array(windows.length);
    let outside = 0,
      after = 0;
    for (let i = 0; i < FRAMES; i++) {
      const added = withEarly[channel]![i]! - without[channel]![i]!;
      const at = windows.findIndex(([from, to]) => i >= from! && i < to!);
      if (at >= 0) inWindow[at]! += added ** 2;
      else outside += added ** 2;
      if (i >= windows.at(-1)![1]!) after = Math.max(after, Math.abs(added));
    }
    const total = inWindow.reduce((sum, e) => sum + e, 0);
    for (const energy of inWindow) expect(energy).toBeGreaterThan(total / 100);
    expect(outside).toBeLessThan(total * 1e-6);
    expect(after).toBeLessThan(1e-6);
  }
});
