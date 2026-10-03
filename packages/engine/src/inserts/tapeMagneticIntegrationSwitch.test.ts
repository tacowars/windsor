/**
 * The magnetic core's rows and its oversampling switch in the shipped Tape
 * insert (windsor#224, design decisions 1 and 6 of
 * `docs/log/2026-09-30-tape-magnetic-integration-design.md`):
 *
 * - Every tape model's fixed core controls and what they map to, pinned; the
 *   susceptibility floor, and a row at the width endpoint refused.
 * - `oversampling`: both factors render, a switch mid-stream starts the
 *   newly selected pair from zero state, and the song keeps the field.
 * - Allocation across a switch, by the heap-delta method of
 *   `tapeMagneticGolden.test.ts` (worklet rule 2): a Node of its own
 *   (`--expose-gc`, a 64 MB young generation, `--trace-generalization`)
 *   evaluates an esbuild bundle of `tapeMagneticStage.ts` as a script named
 *   `tape-magnetic-stage.js`, drives it as `TapeDsp` does — the pair's
 *   fields per sample, the dry ring in place, `select` and `configure` per
 *   block and `glide` per sample while it glides, the factor switched every
 *   fourth quantum and the model every quantum — and reads the heap across
 *   1000 quanta after 6000 of warm-up. Since windsor#289 the rows differ, so
 *   the controls glide throughout and the active pair is retuned every
 *   sample. When that was per block, V8 compiled it to its top tier only
 *   after about 3000 quanta here (2000 left 453 KB boxed in the window, 3000
 *   to 7000 read 600 bytes on Node 24, arm64), so the warm-up is 6000. The rest of
 *   `TapeDsp` is windsor#228's (`tapeAllocation.test.ts`).
 */
// reads-by-path: packages/engine/src/worklet/tape/**
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderTape, tapeRig } from '../__fixtures__/tapeDspProbe';
import { v8Probe } from '../__fixtures__/v8Probe';
import { FieldNormaliser } from '../song/arrangementFields';
import { TapeMagneticCore, originSusceptibility } from '../worklet/tape/tapeMagnetic';
import { assertMagneticRows, magneticControls } from '../worklet/tape/tapeMagneticRows';
import { TAPE_MODELS, TAPE_OVERSAMPLING, TAPE_TYPES } from './tapeConstants';
import { TAPE_MAGNETIC } from './tapeMagneticConstants';
import { sine } from './tapePortableMath';
import { DEFAULT_TAPE, normaliseTape } from './tapeSpec';

const RATE = 48000;
const QUANTUM = 128;
/** The research centre, the row every model carried before windsor#289. */
const CENTRE = { drive: 0.5, width: 0.5, saturation: 0.5 };
const tone = (n: number): number => 0.8 * sine((2 * Math.PI * 220 * n) / RATE);

describe('the model rows (decision 6)', () => {
  it('maps the research centre exactly: Ms 1.25, a 1.25 / 3.01, c √½ − 0.01', () => {
    const c = Math.sqrt(0.5) - 0.01;
    const core = new TapeMagneticCore(RATE, 2, CENTRE);
    expect(core.ms).toBe(1.25);
    expect(1 / core.invA).toBeCloseTo(1.25 / 3.01, 15);
    expect(core.reversibleGain).toBeCloseTo(c * 3.01, 14);
    expect(core.irreversible).toBeCloseTo(1 - c, 15);
    expect(core.susceptibility).toBeCloseTo(0.700214, 6);
    expect(core.susceptibility).toBeGreaterThan(TAPE_MAGNETIC.susceptibilityFloor);
  });

  it('maps every model’s own row (windsor#289): Ms 0.5 + 1.5 (1 − s), a Ms / (0.01 + 6 d), c √(1 − w) − 0.01', () => {
    TAPE_MODELS.forEach(({ magnetic }, i) => {
      const [drive, width, saturation] = magnetic;
      const ms = 0.5 + 1.5 * (1 - saturation);
      const a = ms / (0.01 + 6 * drive);
      const c = Math.sqrt(1 - width) - 0.01;
      const r = ms / a / 3;
      const controls = magneticControls(magnetic, { drive: 0, width: 0, saturation: 0 });
      const core = new TapeMagneticCore(RATE, 2, controls);
      expect(core.ms).toBe(ms);
      expect(1 / core.invA).toBeCloseTo(a, 14);
      expect(core.reversibleGain).toBeCloseTo(c * (ms / a), 14);
      expect(core.irreversible).toBeCloseTo(1 - c, 15);
      expect(core.susceptibility).toBeCloseTo((c * r) / (1 - 1.6e-3 * c * r), 14);
      expect(core.susceptibility).toBeGreaterThan(TAPE_MAGNETIC.susceptibilityFloor);
      // The shipped bundle configures its core from the same row.
      const shipped = tapeRig({ model: TAPE_TYPES[i]! }).dsp.magnetic.active[0]!.core;
      expect(shipped.ms).toBe(core.ms);
      expect(shipped.susceptibility).toBe(originSusceptibility(controls));
    });
  });

  it('accepts the shipped rows and refuses a row at the width endpoint or outside [0, 1]', () => {
    expect(() => assertMagneticRows()).not.toThrow();
    const endpoint = { drive: 0.5, width: 1, saturation: 0.5 };
    expect(originSusceptibility(endpoint)).toBe(0);
    expect(() => assertMagneticRows([{ magnetic: [0.5, 1, 0.5] }])).toThrow(/susceptibility 0/);
    expect(() => assertMagneticRows([{ magnetic: [0.5, 1.5, 0.5] }])).toThrow(/\[0, 1\]/);
    // The floor itself is not above the floor: a row that lands on it is refused too.
    const floor = { ...TAPE_MAGNETIC, susceptibilityFloor: originSusceptibility(endpoint) };
    expect(() => assertMagneticRows([{ magnetic: [0.5, 1, 0.5] }], floor)).toThrow();
  });
});

describe('the oversampling switch (decision 1)', () => {
  it('renders at both factors from two pairs built up front', () => {
    const renders = TAPE_OVERSAMPLING.map((oversampling) => {
      const rig = tapeRig({ oversampling, drive: 24 });
      expect(rig.dsp.magnetic.oversamplers.map((o) => o.factor)).toEqual([2, 4, 2, 4]);
      expect(rig.dsp.magnetic.factor).toBe(oversampling);
      expect(rig.dsp.magnetic.active.map((o) => o.factor)).toEqual([oversampling, oversampling]);
      const { left, resets } = renderTape(rig, tone, RATE / 10);
      expect(left.every(Number.isFinite)).toBe(true);
      expect(left.reduce((sum, v) => sum + v * v, 0)).toBeGreaterThan(0);
      expect(resets).toBe(0);
      return left;
    });
    expect(renders[1]).not.toEqual(renders[0]);
  });

  it('starts the newly selected pair from zero state, each way', () => {
    const rig = tapeRig({ drive: 24 });
    const { dsp, params } = rig;
    let at = 0;
    const run = (quanta: number): void => {
      renderTape(rig, (n) => tone(at + n), quanta * QUANTUM);
      at += quanta * QUANTUM;
    };
    for (const next of [4, 2, 4] as const) {
      run(20);
      const leaving = dsp.magnetic.active[0]!;
      expect(leaving.core.m).not.toBe(0);
      params.oversampling![0] = next;
      dsp.configure(params, QUANTUM);
      for (const pair of dsp.magnetic.active) {
        expect(pair.factor).toBe(next);
        expect(pair).not.toBe(leaving);
        expect(pair.core.m).toBe(0);
        expect(pair.history.every((v) => v === 0)).toBe(true);
        expect(pair.stages.every((v) => v === 0)).toBe(true);
        expect(pair.outputs.every((v) => v === 0)).toBe(true);
      }
    }
    run(20);
    expect(dsp.magnetic.active[0]!.core.resets).toBe(0);
  });

  it('keeps oversampling in the song, and drops a missing or foreign value to 2', () => {
    for (const oversampling of TAPE_OVERSAMPLING) {
      const n = new FieldNormaliser();
      const spec = normaliseTape({ ...DEFAULT_TAPE, oversampling }, 'fx', n);
      expect(spec.oversampling).toBe(oversampling);
      expect(normaliseTape(JSON.parse(JSON.stringify(spec)), 'fx', n)).toEqual(spec);
      expect(n.corrections).toEqual([]);
    }
    const n = new FieldNormaliser();
    expect(normaliseTape({ kind: 'tape' }, 'fx', n).oversampling).toBe(2);
    expect(n.corrections).toEqual([]);
    for (const junk of [3, 8, '4', null]) {
      expect(normaliseTape({ oversampling: junk }, 'fx', n).oversampling).toBe(2);
    }
    expect(n.corrections).toHaveLength(4);
  });
});

/** The child: evaluate the stage's bundle as a script, switch factors, read the heap. */
const PROBE = `
const { readFileSync, writeFileSync } = require('node:fs');
const v8 = require('node:v8');
const vm = require('node:vm');
const [bundle, out, warm, measure] = process.argv.slice(2);
const api = vm.runInThisContext(readFileSync(bundle, 'utf8') + '\\ntapeStage;', { filename: 'tape-magnetic-stage.js' });
const QUANTUM = 128;
const source = new Float64Array(QUANTUM * 64);
for (let i = 0; i < source.length; i++) source[i] = 3.2 * Math.sin(i * 0.031) + 1.6 * Math.sin(i * 0.29);
const output = new Float64Array(QUANTUM);
const stage = new api.TapeMagneticStage(48000, 2, 0);
// One quantum as TapeDsp runs it: select, the song's core on or off (windsor#291) and configure,
// then per sample the glide, each channel's pair and the dry ring.
function quantum(q) {
  stage.select(q % 8 < 4 ? 2 : 4);
  stage.overridden = q % 5 < 2;
  // Doubles across the box, as the parameters deliver them.
  stage.custom.drive = 0.0125 + 0.0975 * (q % 11);
  stage.custom.width = 0.0525 + 0.0565 * (q % 11);
  stage.custom.saturation = 0.0125 + 0.0815 * (q % 13);
  stage.configure(q % 7);
  const base = (q % 64) * QUANTUM;
  for (let i = 0; i < QUANTUM; i++) {
    const x = source[base + i];
    if (stage.gliding) stage.glide();
    for (let channel = 0; channel < 2; channel++) {
      const pair = stage.active[channel];
      pair.input = x;
      pair.advance();
      const at = channel * stage.latency + stage.dryAt;
      output[i] = pair.output + stage.dry[at];
      stage.dry[at] = x;
    }
    stage.dryAt = stage.dryAt + 1 === stage.latency ? 0 : stage.dryAt + 1;
  }
}
function chunks(from, to) {
  for (let q = from; q < to; q += 16) run(q, Math.min(to, q + 16));
}
function run(from, to) {
  for (let q = from; q < to; q++) quantum(q);
}
chunks(0, Number(warm));
gc();
gc();
const profiler = new v8.GCProfiler();
profiler.start();
v8.getHeapStatistics();
const before = v8.getHeapStatistics().used_heap_size;
chunks(Number(warm), Number(warm) + Number(measure));
const after = v8.getHeapStatistics().used_heap_size;
const gcs = profiler.stop().statistics.length;
const pair = stage.active[0];
writeFileSync(out, JSON.stringify({ bytes: after - before, gcs, guards: pair.guards, resets: pair.core.resets }));
`;

interface ProbeResult {
  bytes: number;
  gcs: number;
  guards: number;
  resets: number;
}

function probe(): { result: ProbeResult; changes: string[] } {
  return v8Probe<ProbeResult>({
    entry: fileURLToPath(new URL('../worklet/tape/tapeMagneticStage.ts', import.meta.url)),
    globalName: 'tapeStage',
    bundleName: 'tape-magnetic-stage.js',
    probe: PROBE,
    args: ['6000', '1000'],
  });
}

describe('the magnetic stage on V8', () => {
  it('allocates nothing and changes no field representation across oversampling switches and core overrides', () => {
    const { result, changes } = probe();
    expect(changes).toEqual([]);
    expect(result.gcs, 'no collection ran while the heap was read').toBe(0);
    expect(result.guards, 'the run reached the field guard').toBeGreaterThan(0);
    expect(result.bytes).toBeLessThan(16 * 1024);
  }, 120_000);
});
