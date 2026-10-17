/**
 * Spectre's render, hashed scenario by scenario, as `bloomGolden.test.ts`
 * does: each scenario's interleaved Float32 output from the shipped bundle
 * is hashed (SHA-256) against `__fixtures__/spectreGolden.json`.
 *
 * The program is a 60 ms noise burst (an integer hash, the same bits
 * everywhere) and a 330 Hz tone with its fifth from 0.3 to 0.7 s, by the
 * portable `sine`, not `Math.sin`, which differs by an ulp between V8's arm64
 * and x64 builds; the DSP calls no transcendental `Math` function (its FFT,
 * windows, axis and gains come from `tapePortableMath.ts` and
 * `fm/portablePowers.ts`), so the hashes hold on both. The scenarios cover
 * the defaults, the wet path alone, every analysis extreme, Freeze in both
 * modes, the LFO's slots, Spread and Scatter, stepped and unlinked cells
 * under a moved selection, each algorithm that draws or keeps frames, and
 * the other two rates.
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
import { loadSpectre, runSpectre, setSpectre, spectreParams } from '../__fixtures__/spectreHarness';
import { spectreRampCells } from './spectreCells';
import type { SpectreSpec } from './spectreSpec';
import { sine } from './tapePortableMath';

const REFRESH =
  'WINDSOR_REFRESH_SPECTRE_GOLDEN=1 npx vitest run packages/engine/src/inserts/spectreGolden.test.ts';
const refreshing = process.env['WINDSOR_REFRESH_SPECTRE_GOLDEN'] === '1';
const TABLE = fileURLToPath(new URL('../__fixtures__/spectreGolden.json', import.meta.url));
const EXPECTED_MAJOR = readFileSync(new URL('../../../../.nvmrc', import.meta.url), 'utf8')
  .trim()
  .replace(/^v/, '')
  .split('.')[0];
const RUNNING_MAJOR = process.versions.node.split('.')[0];

const SECONDS = 1.5;

interface Scenario {
  spec: Partial<SpectreSpec>;
  rate?: number;
  /** Set at this quantum: a live move. */
  later?: { quantum: number; spec: Partial<SpectreSpec> };
}

const SCENARIOS: Record<string, Scenario> = {
  default: { spec: {} },
  wet: { spec: { mix: 1 } },
  'fine-4x': { spec: { mix: 1, bands: '2048', overlap: '4x' } },
  'coarse-hard-1x': { spec: { mix: 1, bands: '128', overlap: '1x', window: 'hard' } },
  freeze: { spec: { mix: 1 }, later: { quantum: 60, spec: { mix: 1, freeze: true } } },
  'lfo-spread-scatter': {
    spec: {
      mix: 1,
      lfoHz: 2,
      lfoShape: 'triangle',
      lfoDepth1: 0.4,
      lfoDepth2: 0.6,
      spread: 1,
      scatter: 0.3,
    },
  },
  holes: { spec: { mix: 1, mod: 'holes', modA: 1, modB: 0.7, modC: 0.3 } },
  scatter: { spec: { mix: 1, mod: 'scatter', modA: 0.7, modB: 0.6 } },
  smudge: { spec: { mix: 1, mod: 'smudge', modA: 0.4, modB: 0.8, lfoDepth3: 0.5 } },
  carve: {
    spec: { mix: 1, freezeMode: 'carve' },
    later: { quantum: 60, spec: { mix: 1, freezeMode: 'carve', freeze: true } },
  },
  'cells-steps-select': {
    spec: {
      mix: 1,
      curves: {
        gain: { left: spectreRampCells(0.4, 1), link: true, steps: true },
        delay: {
          left: spectreRampCells(0.1, 0.6),
          right: spectreRampCells(0.6, 0.1),
          link: false,
          steps: true,
        },
        feedback: { left: spectreRampCells(0.6, 0.2), link: true, steps: false },
      },
      selection: [
        [30, 60],
        [100, 140],
      ],
      delaySelect: 0.2,
      feedbackSelect: -0.3,
    },
  },
  phase: { spec: { mix: 1, mod: 'phase', modA: 0.8, modB: 0.5 } },
  'default-44100': { spec: {}, rate: 44100 },
  'default-96000': { spec: {}, rate: 96000 },
};

function program(rate: number): Float32Array[] {
  const frames = Math.round(SECONDS * rate);
  const left = new Float32Array(frames),
    right = new Float32Array(frames);
  let state = 0x9e3779b9;
  const burst = Math.round(0.06 * rate),
    from = Math.round(0.3 * rate),
    to = Math.round(0.7 * rate);
  for (let i = 0; i < frames; i++) {
    let x = 0;
    if (i < burst) {
      state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      x = 0.4 * (state / 4294967296 - 0.5);
    }
    if (i >= from && i < to) {
      const t = i / rate;
      x += 0.25 * sine(2 * Math.PI * 330 * t) + 0.15 * sine(2 * Math.PI * 495 * t);
    }
    left[i] = x;
    right[i] = 0.8 * x;
  }
  return [left, right];
}

function hash(name: string): { hash: string; finite: boolean } {
  const { spec, rate = 48000, later } = SCENARIOS[name]!;
  const params = spectreParams(spec);
  const processor = loadSpectre(rate, params);
  const { left, right } = runSpectre(processor, program(rate), params, (q) => {
    if (later && q === later.quantum) setSpectre(params, later.spec);
  });
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

describe('the Spectre golden', () => {
  it('runs under the Node major the table was written on', () => {
    expect(
      RUNNING_MAJOR,
      `spectreGolden.json is pinned to Node ${EXPECTED_MAJOR} (.nvmrc), not ${process.versions.node}`,
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
          "sha256 of each Spectre scenario's interleaved Float32 render (a noise burst and a 330 Hz tone with its fifth, 1.5 s) through inserts/spectreGolden.test.ts. Written only by that test under WINDSOR_REFRESH_SPECTRE_GOLDEN=1, and only when a render change is intended.",
        hashes,
      };
      writeFileSync(TABLE, `${JSON.stringify(written, null, 2)}\n`);
      return;
    }
    expect(Object.keys(table.hashes).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
});
