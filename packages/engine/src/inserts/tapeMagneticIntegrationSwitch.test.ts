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
 *   block, the factor switched every fourth quantum — and reads the heap
 *   across 1000 quanta. The rest of `TapeDsp` still allocates, as it did
 *   before this change; that is windsor#228's.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { representationChanges } from '../__fixtures__/generalizationTrace';
import { renderTape, tapeRig } from '../__fixtures__/tapeDspProbe';
import { FieldNormaliser } from '../song/arrangementFields';
import { TapeMagneticCore, originSusceptibility } from '../worklet/tape/tapeMagnetic';
import { assertMagneticRows, magneticControls } from '../worklet/tape/tapeMagneticRows';
import { TAPE_MODELS, TAPE_OVERSAMPLING } from './tapeConstants';
import { TAPE_MAGNETIC } from './tapeMagneticConstants';
import { sine } from './tapePortableMath';
import { DEFAULT_TAPE, normaliseTape } from './tapeSpec';

const RATE = 48000;
const QUANTUM = 128;
/** The research centre every model row sits at (decision 6). */
const CENTRE = { drive: 0.5, width: 0.5, saturation: 0.5 };
const tone = (n: number): number => 0.8 * sine((2 * Math.PI * 220 * n) / RATE);

describe('the model rows (decision 6)', () => {
  it('maps every model to the research centre: Ms 1.25, a 1.25 / 3.01, c √½ − 0.01', () => {
    const c = Math.sqrt(0.5) - 0.01;
    for (const { magnetic } of TAPE_MODELS) {
      expect(magnetic).toEqual([CENTRE.drive, CENTRE.width, CENTRE.saturation]);
      const controls = magneticControls(magnetic, { drive: 0, width: 0, saturation: 0 });
      const core = new TapeMagneticCore(RATE, 2, controls);
      expect(core.ms).toBe(1.25);
      expect(1 / core.invA).toBeCloseTo(1.25 / 3.01, 15);
      expect(core.reversibleGain).toBeCloseTo(c * 3.01, 14);
      expect(core.irreversible).toBeCloseTo(1 - c, 15);
      expect(core.susceptibility).toBeCloseTo(0.700214, 6);
      expect(core.susceptibility).toBeGreaterThan(TAPE_MAGNETIC.susceptibilityFloor);
    }
    const shipped = tapeRig({ model: 'vhs' }).dsp.magnetic.active[0]!.core;
    expect(shipped.ms).toBe(1.25);
    expect(shipped.susceptibility).toBe(originSusceptibility(CENTRE));
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
// One quantum as TapeDsp runs it: select and configure, then each channel's pair and dry ring per sample.
function quantum(q) {
  stage.select(q % 8 < 4 ? 2 : 4);
  stage.configure(q % 7, QUANTUM);
  const base = (q % 64) * QUANTUM;
  for (let i = 0; i < QUANTUM; i++) {
    const x = source[base + i];
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
  const entry = fileURLToPath(new URL('../worklet/tape/tapeMagneticStage.ts', import.meta.url));
  const bundled = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'tapeStage',
    platform: 'neutral',
    target: 'esnext',
    minify: false,
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  });
  const dir = mkdtempSync(join(tmpdir(), 'tape-magnetic-stage-'));
  try {
    const files = { bundle: join(dir, 'tape-magnetic-stage.js'), probe: join(dir, 'probe.cjs') };
    writeFileSync(files.bundle, bundled.outputFiles[0]!.text);
    writeFileSync(files.probe, PROBE);
    const out = join(dir, 'result.json');
    const flags = ['--expose-gc', '--min-semi-space-size=64', '--max-semi-space-size=64'];
    const child = spawnSync(
      process.execPath,
      [
        ...flags,
        '--trace-generalization',
        '--no-warnings',
        files.probe,
        files.bundle,
        out,
        '2000',
        '1000',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    expect(child.status, child.stderr).toBe(0);
    return {
      result: JSON.parse(readFileSync(out, 'utf8')) as ProbeResult,
      changes: representationChanges(child.stdout, 'tape-magnetic-stage.js'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the magnetic stage on V8', () => {
  it('allocates nothing and changes no field representation across oversampling switches', () => {
    const { result, changes } = probe();
    expect(changes).toEqual([]);
    expect(result.gcs, 'no collection ran while the heap was read').toBe(0);
    expect(result.guards, 'the run reached the field guard').toBeGreaterThan(0);
    expect(result.bytes).toBeLessThan(16 * 1024);
  }, 120_000);
});
