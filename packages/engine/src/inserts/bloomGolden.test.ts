/**
 * bloom's render, hashed scenario by scenario, as Windsor's
 * `tapeMagneticGolden.test.ts` does: each scenario's interleaved Float32
 * output from the shipped bundle is hashed (SHA-256) against
 * `__fixtures__/bloomGolden.json`.
 *
 * The program is a 50 ms noise burst (an integer hash, the same bits
 * everywhere), a 220 Hz tone from 0.1 to 0.6 s and a C–E–G chord from 0.8
 * to 1.4 s, by the portable `sine`, not `Math.sin`, which differs by an ulp
 * between V8's arm64 and x64 builds; the DSP itself calls no transcendental
 * `Math` function (`bloomPortable.ts`, `fm/portablePowers.ts`), so the hashes
 * hold on both.
 *
 * Every scenario is at the defaults (Mix aside): a lever that is built must
 * leave these hashes as they are, which proves its default is neutral to
 * the bit. Pin a lever's own sound in its own test.
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
import { mixed, noise, renderBloom, tone } from '../__fixtures__/bloomHarness';
import type { BloomSpec } from './bloomSpec';

const REFRESH =
  'WINDSOR_REFRESH_BLOOM_GOLDEN=1 npx vitest run packages/engine/src/inserts/bloomGolden.test.ts';
const refreshing = process.env['WINDSOR_REFRESH_BLOOM_GOLDEN'] === '1';
const TABLE = fileURLToPath(new URL('../__fixtures__/bloomGolden.json', import.meta.url));
const EXPECTED_MAJOR = readFileSync(new URL('../../../../.nvmrc', import.meta.url), 'utf8')
  .trim()
  .replace(/^v/, '')
  .split('.')[0];
const RUNNING_MAJOR = process.versions.node.split('.')[0];

const SECONDS = 2;
const CHORD = [261.6256, 329.6276, 391.9954];

interface Scenario {
  spec: Partial<BloomSpec>;
  rate?: number;
}

const SCENARIOS: Record<string, Scenario> = {
  default: { spec: {} },
  wet: { spec: { mix: 1 } },
  'default-44100': { spec: {}, rate: 44100 },
  'default-96000': { spec: {}, rate: 96000 },
};

function hash(name: string): { hash: string; finite: boolean } {
  const { spec, rate = 48000 } = SCENARIOS[name]!;
  const at = (s: number): number => Math.round(s * rate);
  const source = mixed(
    noise(0.5, 0, at(0.05)),
    tone(220, 0.25, rate, at(0.1), at(0.6)),
    ...CHORD.map((hz) => tone(hz, 0.15, rate, at(0.8), at(1.4))),
  );
  const { left, right } = renderBloom(spec, { rate, seconds: SECONDS, source });
  const interleaved = new Float32Array(2 * left.length);
  for (let i = 0; i < left.length; i++) {
    interleaved[2 * i] = left[i]!;
    interleaved[2 * i + 1] = right[i]!;
  }
  return {
    hash: createHash('sha256').update(Buffer.from(interleaved.buffer)).digest('hex'),
    finite: interleaved.every(Number.isFinite),
  };
}

const table = existsSync(TABLE)
  ? (JSON.parse(readFileSync(TABLE, 'utf8')) as { hashes: Record<string, string> })
  : { hashes: {} as Record<string, string> };

describe('the bloom golden', () => {
  it('runs under the Node major the table was written on', () => {
    expect(
      RUNNING_MAJOR,
      `bloomGolden.json is pinned to Node ${EXPECTED_MAJOR} (.nvmrc), not ${process.versions.node}`,
    ).toBe(EXPECTED_MAJOR);
  });

  const hashes: Record<string, string> = {};
  for (const name of Object.keys(SCENARIOS)) {
    it(`renders ${name} as pinned`, () => {
      const result = hash(name);
      hashes[name] = result.hash;
      expect(result.finite).toBe(true);
      if (refreshing) return;
      expect(result.hash, `${name} changed; if intended, run ${REFRESH}`).toBe(table.hashes[name]);
    });
  }

  it('pins every scenario', () => {
    if (refreshing) {
      const written = {
        about:
          "sha256 of each bloom scenario's interleaved Float32 render (a noise burst, a 220 Hz tone and a C-E-G chord, 2 s) through inserts/bloomGolden.test.ts. Written only by that test under WINDSOR_REFRESH_BLOOM_GOLDEN=1, and only when a render change is intended.",
        hashes,
      };
      writeFileSync(TABLE, `${JSON.stringify(written, null, 2)}\n`);
      return;
    }
    expect(Object.keys(table.hashes).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
});
