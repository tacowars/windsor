/**
 * The Dub delay's render (record `2026-10-17-dub-delay-regeneration`),
 * hashed scenario by scenario as `bloomGolden.test.ts` does: each scenario's
 * interleaved Float32 output from the shipped bundle is hashed (SHA-256)
 * against `__fixtures__/delayGolden.json`.
 *
 * The program is a 50 ms noise burst, a 220 Hz tone from 0.1 to 0.6 s and a
 * C–E–G chord from 0.8 to 1.4 s (`bloomHarness.ts`'s stateless noise and
 * portable `sine`), then silence to 3 s, so every scenario's repeats ring on
 * alone. The scenarios are the defaults at the three rates, every starting
 * point, Sustain held over the chord, and each filter shape, character and
 * motion shape not already covered. The DSP calls no transcendental `Math`
 * function (`fm/portablePowers.ts`, `fm/portableTangent.ts`,
 * `tapePortableMath.ts`), so the hashes hold on arm64 and x64.
 *
 * A failure means the render changed. When that is intended, refresh with
 * `REFRESH` and say so in the PR; a refactor never refreshes it. The table is
 * pinned to `.nvmrc`'s Node major, as Windsor's other goldens are.
 */
// reads-by-path: packages/engine/src/worklet/generated/**, packages/engine/src/__fixtures__/**, .nvmrc
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mixed, noise, tone } from '../__fixtures__/bloomHarness';
import type { BloomSource } from '../__fixtures__/bloomHarness';
import { delayParams, loadDelay } from '../__fixtures__/delayHarness';
import { DEFAULT_DELAY } from './delaySpec';
import type { DelaySpec } from './delaySpec';
import { applyDelayPreset, DELAY_PRESETS } from './delayPresets';

const REFRESH =
  'WINDSOR_REFRESH_DELAY_GOLDEN=1 npx vitest run packages/engine/src/inserts/delayGolden.test.ts';
const refreshing = process.env['WINDSOR_REFRESH_DELAY_GOLDEN'] === '1';
const TABLE = fileURLToPath(new URL('../__fixtures__/delayGolden.json', import.meta.url));
const EXPECTED_MAJOR = readFileSync(new URL('../../../../.nvmrc', import.meta.url), 'utf8')
  .trim()
  .replace(/^v/, '')
  .split('.')[0];
const RUNNING_MAJOR = process.versions.node.split('.')[0];

const SECONDS = 3;
const BLOCK = 128;
const CHORD = [261.6256, 329.6276, 391.9954];

interface Scenario {
  spec: Partial<DelaySpec>;
  rate?: number;
  /** Sustain from this many seconds on. */
  sustainAt?: number;
}

const SCENARIOS: Record<string, Scenario> = {
  default: { spec: {} },
  'default-44100': { spec: {}, rate: 44100 },
  'default-96000': { spec: {}, rate: 96000 },
  ...Object.fromEntries(
    DELAY_PRESETS.map((preset) => [
      `preset-${preset.id}`,
      { spec: { ...applyDelayPreset(DEFAULT_DELAY, preset.id), mix: 0.5 } },
    ]),
  ),
  sustain: { spec: { mix: 1, feedback: 0.7 }, sustainAt: 1 },
  highpass: { spec: { filter: 'highpass', cutoff: 900, resonance: 9, mix: 1 } },
  fold: { spec: { character: 'fold', drive: 24, mix: 1 }, rate: 44100 },
  motion: { spec: { wave: 'sine', wow: 1, sweep: 2, modRate: 3, mode: 'mid-side', mix: 1 } },
};

function render(name: string): Float32Array {
  const { spec, rate = 48000, sustainAt } = SCENARIOS[name]!;
  const at = (s: number): number => Math.round(s * rate);
  const source: BloomSource = mixed(
    noise(0.5, 0, at(0.05)),
    tone(220, 0.25, rate, at(0.1), at(0.6)),
    ...CHORD.map((hz) => tone(hz, 0.15, rate, at(0.8), at(1.4))),
  );
  const params = delayParams(spec);
  const processor = loadDelay(rate, params);
  const blocks = Math.ceil((SECONDS * rate) / BLOCK);
  const interleaved = new Float32Array(2 * blocks * BLOCK);
  const input = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  for (let b = 0; b < blocks; b++) {
    const frame = b * BLOCK;
    if (sustainAt !== undefined && frame >= at(sustainAt)) params.sustain![0] = 1;
    for (let i = 0; i < BLOCK; i++) {
      input[0]![i] = source(frame + i, 0);
      input[1]![i] = source(frame + i, 1);
    }
    processor.process([input], [output], params);
    for (let i = 0; i < BLOCK; i++) {
      interleaved[2 * (frame + i)] = output[0]![i]!;
      interleaved[2 * (frame + i) + 1] = output[1]![i]!;
    }
  }
  return interleaved;
}

const table = existsSync(TABLE)
  ? (JSON.parse(readFileSync(TABLE, 'utf8')) as { hashes: Record<string, string> })
  : { hashes: {} as Record<string, string> };

describe('the Dub delay golden', () => {
  it('runs under the Node major the table was written on', () => {
    expect(
      RUNNING_MAJOR,
      `delayGolden.json is pinned to Node ${EXPECTED_MAJOR} (.nvmrc), not ${process.versions.node}`,
    ).toBe(EXPECTED_MAJOR);
  });

  const hashes: Record<string, string> = {};
  for (const name of Object.keys(SCENARIOS)) {
    it(`renders ${name} as pinned`, () => {
      const samples = render(name);
      const hash = createHash('sha256').update(Buffer.from(samples.buffer)).digest('hex');
      hashes[name] = hash;
      expect(samples.every(Number.isFinite)).toBe(true);
      if (refreshing) return;
      expect(hash, `${name} changed; if intended, run ${REFRESH}`).toBe(table.hashes[name]);
    });
  }

  it('pins every scenario', () => {
    if (refreshing) {
      const written = {
        about:
          "sha256 of each Dub delay scenario's interleaved Float32 render (a noise burst, a 220 Hz tone and a C-E-G chord, then silence, 3 s) through inserts/delayGolden.test.ts. Written only by that test under WINDSOR_REFRESH_DELAY_GOLDEN=1, and only when a render change is intended.",
        hashes,
      };
      writeFileSync(TABLE, `${JSON.stringify(written, null, 2)}\n`);
      return;
    }
    expect(Object.keys(table.hashes).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
});
