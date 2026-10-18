/**
 * The Transient insert's render (record `2026-10-18-transient-insert`),
 * hashed scenario by scenario as `delayGolden.test.ts` does: each scenario's
 * interleaved Float32 output from the shipped bundle is hashed (SHA-256)
 * against `__fixtures__/transientGolden.json`.
 *
 * The program is a drum figure in portable arithmetic (`tapePortableMath.ts`'s
 * `sine` and `exp2`, and `bloomHarness.ts`'s stateless noise): a kick, a 55 Hz
 * sine decaying over 120 ms, on every quarter of a second, a hat of noise
 * decaying over 15 ms on each eighth between, then a 110 Hz tone held from
 * 1 to 1.6 s and silence to 2.5 s, so the followers release and the insert
 * sleeps. The scenarios, each at 44.1 and 48 kHz: "punch" (Attack +10,
 * Sustain −12), "lift" (Attack −15, Sustain +24, Output −6 dB, Mix 0.5) and
 * "ride" (Attack ridden from −15 to +15 a quantum at a time over the first
 * second at Sustain −24, the switch off at 0.7 s and back on at 0.9 s). The
 * DSP calls no transcendental `Math` function (`fm/portablePowers.ts`), so
 * the hashes hold on arm64 and x64.
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
import { mixed, noise } from '../__fixtures__/bloomHarness';
import type { BloomSource } from '../__fixtures__/bloomHarness';
import { loadTransient, transientParams } from '../__fixtures__/transientHarness';
import { exp2, sine } from './tapePortableMath';
import type { TransientSpec } from './transientSpec';

const REFRESH =
  'WINDSOR_REFRESH_TRANSIENT_GOLDEN=1 npx vitest run packages/engine/src/inserts/transientGolden.test.ts';
const refreshing = process.env['WINDSOR_REFRESH_TRANSIENT_GOLDEN'] === '1';
const TABLE = fileURLToPath(new URL('../__fixtures__/transientGolden.json', import.meta.url));
const EXPECTED_MAJOR = readFileSync(new URL('../../../../.nvmrc', import.meta.url), 'utf8')
  .trim()
  .replace(/^v/, '')
  .split('.')[0];
const RUNNING_MAJOR = process.versions.node.split('.')[0];

const SECONDS = 2.5;
const BLOCK = 128;
const LOG2_E = 1.4426950408889634;

interface Scenario {
  spec: Partial<TransientSpec>;
  /** Attack from −15 to +15 over the first second, and the switch off from 0.7 to 0.9 s. */
  ride?: boolean;
}

const SETTINGS: Record<string, Scenario> = {
  punch: { spec: { attack: 10, sustain: -12 } },
  lift: { spec: { attack: -15, sustain: 24, output: -6, mix: 0.5 } },
  ride: { spec: { attack: -15, sustain: -24 }, ride: true },
};
const RATES = [44100, 48000];
const SCENARIOS = Object.keys(SETTINGS).flatMap((name) => RATES.map((rate) => `${name}-${rate}`));

/** `amplitude` · e^(−t/τ) from `from` for `frames`, times `source`, in portable arithmetic. */
const decaying =
  (
    source: BloomSource,
    amplitude: number,
    tau: number,
    from: number,
    frames: number,
  ): BloomSource =>
  (frame, channel) => {
    const t = frame - from;
    if (t < 0 || t >= frames) return 0;
    return amplitude * exp2((-LOG2_E * t) / tau) * source(t, channel);
  };

/** The drum figure, the held tone and the silence at `rate`. */
function program(rate: number): BloomSource {
  const at = (s: number): number => Math.round(s * rate);
  const kick: BloomSource = (t) => sine((2 * Math.PI * 55 * t) / rate + Math.PI / 2);
  const hits: BloomSource[] = [];
  for (let beat = 0; beat < 4; beat++) {
    hits.push(decaying(kick, 0.8, 0.12 * rate, at(beat * 0.25), at(0.24)));
    hits.push(decaying(noise(1), 0.3, 0.015 * rate, at(beat * 0.25 + 0.125), at(0.1)));
  }
  const held: BloomSource = (frame) =>
    frame < at(1) || frame >= at(1.6) ? 0 : 0.2 * sine((2 * Math.PI * 110 * frame) / rate);
  return mixed(...hits, held);
}

function render(name: string): Float32Array {
  const [setting, rateText] = name.split('-');
  const { spec, ride } = SETTINGS[setting!]!;
  const rate = Number(rateText);
  const source = program(rate);
  const params = transientParams(spec);
  const processor = loadTransient(rate, params);
  const blocks = Math.ceil((SECONDS * rate) / BLOCK);
  const interleaved = new Float32Array(2 * blocks * BLOCK);
  const input = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  for (let b = 0; b < blocks; b++) {
    const frame = b * BLOCK;
    if (ride) {
      params.attack![0] = -15 + 30 * Math.min(1, frame / rate);
      params.enabled![0] = frame >= 0.7 * rate && frame < 0.9 * rate ? 0 : 1;
    }
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

describe('the Transient golden', () => {
  it('runs under the Node major the table was written on', () => {
    expect(
      RUNNING_MAJOR,
      `transientGolden.json is pinned to Node ${EXPECTED_MAJOR} (.nvmrc), not ${process.versions.node}`,
    ).toBe(EXPECTED_MAJOR);
  });

  const hashes: Record<string, string> = {};
  for (const name of SCENARIOS) {
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
          "sha256 of each Transient scenario's interleaved Float32 render (a kick and hat figure, a held 110 Hz tone, then silence, 2.5 s) through inserts/transientGolden.test.ts. Written only by that test under WINDSOR_REFRESH_TRANSIENT_GOLDEN=1, and only when a render change is intended.",
        hashes,
      };
      writeFileSync(TABLE, `${JSON.stringify(written, null, 2)}\n`);
      return;
    }
    expect(Object.keys(table.hashes).sort()).toEqual([...SCENARIOS].sort());
  });
});
