/**
 * The neutral pin (RV-0): Retro Reverb's sound at every new field's neutral default stays as it
 * was before those fields existed. Five settings, each fed an impulse and a seeded 50 ms noise
 * burst, render 2 s at 48 kHz through the generated processor; the fingerprint is the RMS of each
 * 10 ms window per channel, held to `__fixtures__/retroReverbNeutralPin.json` at a relative
 * tolerance of 1e-6 above an absolute floor of 1e-9 (about −180 dB) for windows near silence.
 * That passes the last-ulp drift of V8's `Math` between arm64 and x64 and fails any audible
 * change. Refresh only for an intended change to the neutral sound:
 * `WINDSOR_REFRESH_RETRO_NEUTRAL_PIN=1 npx vitest run packages/engine/src/inserts/retroReverbNeutralPin.test.ts`,
 * then `npx prettier --write` the fixture.
 */
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadRetro, retroParams } from '../__fixtures__/retroReverbHarness';
import pinned from '../__fixtures__/retroReverbNeutralPin.json';
import { mulberry32 } from '../sequencing/mulberry32';
import type { RetroReverbSpec } from './retroReverbSpec';

const RATE = 48000;
const FRAMES = 2 * RATE;
const WINDOW = RATE / 100;
const BLOCK = 128;
const RELATIVE = 1e-6;
const FLOOR = 1e-9;
const FIXTURE = new URL('../__fixtures__/retroReverbNeutralPin.json', import.meta.url);

const SETTINGS: Record<string, Partial<RetroReverbSpec>> = {
  reverb: {},
  gated: { mode: 'gated' },
  reverse: { mode: 'reverse' },
  long: { decay: 8, size: 2.5, tone: 2500, diffusion: 0.9, preDelay: 0.08 },
  bright: { decay: 0.5, size: 0.4, tone: 9000, diffusion: 0.3, character: 0.2 },
};
const SOURCES: Record<string, () => Float32Array> = {
  impulse: () => {
    const input = new Float32Array(FRAMES);
    input[0] = 0.8;
    return input;
  },
  noise: () => {
    const random = mulberry32(682);
    const input = new Float32Array(FRAMES);
    for (let i = 0; i < RATE / 20; i++) input[i] = random() - 0.5;
    return input;
  },
};

/** Per channel, the RMS of each 10 ms window of `spec`'s response to `input`, at Mix 1. */
function fingerprint(spec: Partial<RetroReverbSpec>, input: Float32Array): number[][] {
  const params = retroParams({ mix: 1, ...spec });
  const processor = loadRetro(RATE, params);
  const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const sums = [new Float64Array(FRAMES / WINDOW), new Float64Array(FRAMES / WINDOW)];
  for (let frame = 0; frame < FRAMES; frame += BLOCK) {
    const block = input.subarray(frame, frame + BLOCK);
    processor.process([[block, block]], [output], params);
    for (let channel = 0; channel < 2; channel++)
      for (let i = 0; i < BLOCK; i++)
        sums[channel]![Math.floor((frame + i) / WINDOW)]! += output[channel]![i]! ** 2;
  }
  return sums.map((sum) =>
    [...sum].map((total) => Number(Math.sqrt(total / WINDOW).toPrecision(9))),
  );
}

function renderAll(): Record<string, number[][]> {
  const result: Record<string, number[][]> = {};
  for (const [setting, spec] of Object.entries(SETTINGS))
    for (const [source, make] of Object.entries(SOURCES))
      result[`${setting}/${source}`] = fingerprint(spec, make());
  return result;
}

it('renders as before at the neutral defaults', () => {
  const actual = renderAll();
  // The import holds the fixture as it was before this run, so a refresh writes and stops here.
  if (process.env.WINDSOR_REFRESH_RETRO_NEUTRAL_PIN === '1') {
    writeFileSync(FIXTURE, `${JSON.stringify(actual)}\n`);
    return;
  }
  const expected: Record<string, number[][]> = pinned;
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  for (const [name, channels] of Object.entries(expected))
    channels.forEach((windows, channel) =>
      windows.forEach((want, window) => {
        const got = actual[name]![channel]![window]!;
        const limit = Math.max(FLOOR, RELATIVE * Math.max(Math.abs(want), Math.abs(got)));
        if (Math.abs(got - want) > limit)
          expect.fail(`${name} channel ${channel} window ${window}: ${got} against ${want}`);
      }),
    );
  expect(actual['reverb/impulse']![0]!.slice(10).some((rms) => rms > 1e-4)).toBe(true);
});
