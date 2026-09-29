/**
 * The output stage's render, hashed, mode by mode (windsor#93 decision 12),
 * in the shape of `reverbGolden.test.ts`: a fixture signal that rises from
 * well under the ceiling to 12 dB over it, with clicks on top, is run through
 * the generated processor in every mode with the lookahead off and on, and
 * once more with its settings changed mid-render, and each render's
 * interleaved Float32 output is hashed against
 * `__fixtures__/outputStageGolden.json`.
 *
 * A failure means the render changed. When that is intended (a DSP ticket),
 * refresh the table with the command in `REFRESH` and say so in the PR; a
 * refactor never refreshes it. The table is pinned to `.nvmrc`'s Node major,
 * as the FM table is (`worklet/CLAUDE.md` rule 4): the filter and the curves
 * are built with `Math`, which V8 may round differently in another major.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import golden from '../__fixtures__/outputStageGolden.json';
import type { StageSettings } from '../__fixtures__/outputStageHarness';
import { renderStage } from '../__fixtures__/outputStageHarness';
import { OUTPUT_STAGE_MODES } from './outputStageConstants';

const REFRESH =
  'WINDSOR_REFRESH_OUTPUT_STAGE_GOLDEN=1 npx vitest run packages/engine/src/mixer/outputStageGolden.test.ts';
const refreshing = process.env['WINDSOR_REFRESH_OUTPUT_STAGE_GOLDEN'] === '1';
const TABLE = fileURLToPath(new URL('../__fixtures__/outputStageGolden.json', import.meta.url));
const EXPECTED_MAJOR = readFileSync(new URL('../../../../.nvmrc', import.meta.url), 'utf8')
  .trim()
  .replace(/^v/, '')
  .split('.')[0];
const RUNNING_MAJOR = process.versions.node.split('.')[0];

const RATE = 48000;
const SECONDS = 1.5;

/**
 * Three tones under an envelope that rises from −30 dBFS to +11 dBFS (12 dB
 * over the default ceiling), a click every 100 ms on the left and a
 * different mix on the right. Deterministic: no random source.
 */
function fixture(): [Float32Array, Float32Array] {
  const frames = Math.round(SECONDS * RATE);
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    const gain = Math.pow(10, (-30 + (41 * i) / frames) / 20);
    const a = Math.sin(2 * Math.PI * 110 * t);
    const b = Math.sin(2 * Math.PI * 1234 * t + 0.5);
    const c = Math.sin(2 * Math.PI * 5003 * t + 1.3);
    l[i] = gain * (0.6 * a + 0.3 * b + 0.1 * c) + (i % 4800 === 0 ? 0.8 : 0);
    r[i] = gain * (0.2 * a + 0.5 * b + 0.3 * c);
  }
  return [l, r];
}

interface Scenario {
  settings: StageSettings;
  retune?: (block: number) => StageSettings | null;
}

const SCENARIOS: Record<string, Scenario> = {};
for (const mode of OUTPUT_STAGE_MODES) {
  for (const lookahead of [false, true]) {
    SCENARIOS[`${mode}${lookahead ? '-lookahead' : ''}`] = { settings: { mode, lookahead } };
  }
}
SCENARIOS['live-changes'] = {
  settings: { mode: 'limiter' },
  retune: (block) => {
    if (block === 150) return { mode: 'limiter', ceilingDb: -6, lookahead: true };
    if (block === 300) return { mode: 'soft', ceilingDb: -6 };
    if (block === 420) return { mode: 'hard', ceilingDb: 0 };
    return null;
  },
};

function hashRender(scenario: Scenario): string {
  const [l, r] = fixture();
  const out = renderStage(
    scenario.settings,
    l,
    r,
    scenario.retune ? { retune: scenario.retune } : {},
  );
  const interleaved = new Float32Array(out.left.length * 2);
  for (let i = 0; i < out.left.length; i++) {
    interleaved[2 * i] = out.left[i]!;
    interleaved[2 * i + 1] = out.right[i]!;
  }
  return createHash('sha256').update(Buffer.from(interleaved.buffer)).digest('hex');
}

describe('output stage golden', () => {
  it('runs under the Node major the table was written on', () => {
    expect(
      RUNNING_MAJOR,
      `outputStageGolden.json is pinned to Node ${EXPECTED_MAJOR} (.nvmrc), not ${process.versions.node}`,
    ).toBe(EXPECTED_MAJOR);
  });

  const hashes: Record<string, string> = {};
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(`renders ${name} as pinned`, () => {
      hashes[name] = hashRender(scenario);
      if (refreshing) return;
      const table = golden.hashes as Record<string, string>;
      expect(hashes[name], `${name} changed; if intended, run ${REFRESH}`).toBe(table[name]);
    });
  }

  it('pins every scenario', () => {
    if (refreshing) {
      const table = {
        about:
          'sha256 of each output stage scenario rendered through mixer/outputStageGolden.test.ts: the interleaved Float32 output of the generated processor on its fixture signal. Written only by that test under WINDSOR_REFRESH_OUTPUT_STAGE_GOLDEN=1, and only when a render change is intended (windsor#93).',
        sampleRate: RATE,
        hashes,
      };
      writeFileSync(TABLE, `${JSON.stringify(table, null, 2)}\n`);
      return;
    }
    expect(Object.keys(golden.hashes).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
});
