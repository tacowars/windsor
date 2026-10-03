/**
 * The magnetic Tape module's render, pinned bit for bit (windsor#219
 * decision 8), and its per-sample path measured on V8 for allocation.
 *
 * Golden: a deterministic two-second stereo program at 48 kHz — three tones
 * on the left, two and a signed pulse on the right, both under a Drive sweep
 * from the lower bound to the upper through `driveGain` — runs through one
 * `TapeOversampler` per channel at the centre row, at 2× and at 4×. The
 * interleaved Float64 output is hashed against
 * `__fixtures__/tapeMagneticGolden.json`, with the guard and reset counts.
 * `__fixtures__/tapeMagneticGoldenSamples.json` keeps every `STRIDE`-th
 * frame of each render (both channels, Float64, base64): the hash stays the
 * pin, and on a mismatch the record says where the render left it (the
 * first differing recorded sample, the largest difference and where).
 * A failure means the render changed; when that is intended, refresh with
 * `REFRESH` and say so in the PR. A refactor never refreshes it. The table
 * is pinned to `.nvmrc`'s Node major, as the other goldens are
 * (`worklet/CLAUDE.md` rule 4). The program, the kernel and the core call no
 * transcendental `Math` function (`tapePortableMath.ts`), so the render is
 * the same bits on arm64 and x64; a hash that holds on one and not the
 * other is a defect in the module, not a platform to pin separately.
 *
 * Allocation (worklet rule 2), by the heap-delta method: a Node of its own
 * (`--expose-gc`, a 64 MB young generation so nothing is collected before it
 * is counted, `--trace-generalization`) evaluates an esbuild bundle of
 * `tapeOversample.ts` as a script named `tape-magnetic.js`, warms both
 * factors on a signal that crosses the knee and the field guard, then reads
 * `used_heap_size` across 2000 quanta of `render`. One boxed double per host
 * sample would read about 4 MB; the tolerance is 16 KiB. No field the bundle
 * writes may change its representation (`__fixtures__/generalizationTrace.ts`).
 */
// reads-by-path: packages/engine/src/__fixtures__/**, .nvmrc, packages/engine/src/worklet/tape/tapeOversample.ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import golden from '../__fixtures__/tapeMagneticGolden.json';
import samples from '../__fixtures__/tapeMagneticGoldenSamples.json';
import { representationChanges } from '../__fixtures__/generalizationTrace';
import { TapeOversampler } from '../worklet/tape/tapeOversample';
import { TAPE_DRIVE_GAIN, TAPE_MAGNETIC, driveGain } from './tapeMagneticConstants';
import { sine } from './tapePortableMath';

const REFRESH =
  'WINDSOR_REFRESH_TAPE_MAGNETIC_GOLDEN=1 npx vitest run packages/engine/src/inserts/tapeMagneticGolden.test.ts';
const refreshing = process.env['WINDSOR_REFRESH_TAPE_MAGNETIC_GOLDEN'] === '1';
const TABLE = fileURLToPath(new URL('../__fixtures__/tapeMagneticGolden.json', import.meta.url));
const SAMPLES = fileURLToPath(
  new URL('../__fixtures__/tapeMagneticGoldenSamples.json', import.meta.url),
);
const EXPECTED_MAJOR = readFileSync(new URL('../../../../.nvmrc', import.meta.url), 'utf8')
  .trim()
  .replace(/^v/, '')
  .split('.')[0];
const RUNNING_MAJOR = process.versions.node.split('.')[0];

const RATE = 48000;
const SECONDS = 2;
/** The per-sample record keeps every `STRIDE`-th frame: 750 frames of each render, about 16 kB each. */
const STRIDE = 128;

/**
 * The program: tones and a signed pulse under a Drive sweep from the lower
 * bound to the upper. Its tones are `sine`'s, not `Math.sin`'s, which
 * differs by an ulp between V8's arm64 and x64 builds, so the input is the
 * same bits everywhere.
 */
function program(): [Float64Array, Float64Array] {
  const frames = SECONDS * RATE;
  const [low, high] = TAPE_DRIVE_GAIN.bounds;
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (let n = 0; n < frames; n++) {
    const t = n / RATE;
    const gain = driveGain(low + ((high - low) * n) / (frames - 1));
    const pulse = t >= 0.5 && t < 0.52 ? 0.8 : t >= 1.3 && t < 1.32 ? -0.8 : 0;
    left[n] =
      gain *
      (0.6 * sine(2 * Math.PI * 110 * t) +
        0.3 * sine(2 * Math.PI * 1234 * t + 0.5) +
        0.15 * sine(2 * Math.PI * 5003 * t + 1.3));
    right[n] =
      gain * (0.3 * sine(2 * Math.PI * 220 * t) + 0.2 * sine(2 * Math.PI * 3100 * t) + pulse);
  }
  return [left, right];
}

function render(factor: number) {
  const [left, right] = program();
  const channels = [new TapeOversampler(RATE, factor), new TapeOversampler(RATE, factor)];
  const interleaved = new Float64Array(2 * left.length);
  for (let n = 0; n < left.length; n++) {
    interleaved[2 * n] = channels[0]!.process(left[n]!);
    interleaved[2 * n + 1] = channels[1]!.process(right[n]!);
  }
  return {
    pinned: {
      hash: createHash('sha256').update(Buffer.from(interleaved.buffer)).digest('hex'),
      leftGuards: channels[0]!.guards,
      rightGuards: channels[1]!.guards,
      leftResets: channels[0]!.core.resets,
      rightResets: channels[1]!.core.resets,
    },
    record: record(interleaved),
    finite: interleaved.every(Number.isFinite),
  };
}

/** Every `STRIDE`-th frame of an interleaved stereo render, both channels. */
function record(interleaved: Float64Array): Float64Array {
  const frames = Math.ceil(interleaved.length / 2 / STRIDE);
  const kept = new Float64Array(2 * frames);
  for (let f = 0; f < frames; f++) {
    kept[2 * f] = interleaved[2 * f * STRIDE]!;
    kept[2 * f + 1] = interleaved[2 * f * STRIDE + 1]!;
  }
  return kept;
}

const encode = (values: Float64Array) =>
  Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('base64');

function decode(text: string | undefined): Float64Array | undefined {
  if (text === undefined) return undefined;
  const bytes = Buffer.from(text, 'base64');
  return new Float64Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

/**
 * Where a render leaves the pinned record: the first recorded sample that
 * differs (by bits: -0 differs from 0), the largest absolute difference and
 * where, and the guard and reset counts against the pinned ones.
 */
function diagnose(result: ReturnType<typeof render>, factor: number): string {
  const name = `${factor}x`;
  const actual = result.record;
  const pinned = decode((samples.renders as Record<string, string | undefined>)[name]);
  const counts = `guards L/R ${result.pinned.leftGuards}/${result.pinned.rightGuards}, resets L/R ${result.pinned.leftResets}/${result.pinned.rightResets}`;
  const was = (golden.renders as Record<string, typeof result.pinned | undefined>)[name];
  const pinnedCounts = was
    ? ` (pinned ${was.leftGuards}/${was.rightGuards} and ${was.leftResets}/${was.rightResets})`
    : '';
  if (!pinned || pinned.length !== actual.length)
    return `${name}: no per-sample record to compare; ${counts}${pinnedCounts}`;
  let first = -1;
  let largest = 0;
  let at = -1;
  for (let i = 0; i < actual.length; i++) {
    if (Object.is(actual[i], pinned[i])) continue;
    if (first < 0) first = i;
    const difference = Math.abs(actual[i]! - pinned[i]!);
    if (!(difference <= largest)) {
      largest = difference;
      at = i;
    }
  }
  const where = (i: number) => `frame ${(i >> 1) * STRIDE} ${i & 1 ? 'right' : 'left'}`;
  const found =
    first < 0
      ? `every recorded sample (each ${STRIDE}th frame) matches, so the change is between them`
      : `first differing recorded sample at ${where(first)}, largest |difference| ${largest} at ${where(at)} (each ${STRIDE}th frame recorded)`;
  return `${name}: ${found}; ${counts}${pinnedCounts}`;
}

describe('the magnetic Tape golden', () => {
  it('runs under the Node major the table was written on', () => {
    expect(
      RUNNING_MAJOR,
      `tapeMagneticGolden.json is pinned to Node ${EXPECTED_MAJOR} (.nvmrc), not ${process.versions.node}`,
    ).toBe(EXPECTED_MAJOR);
  });

  const renders: Record<string, ReturnType<typeof render>> = {};
  for (const factor of TAPE_MAGNETIC.factors) {
    it(`renders the program at ${factor}x as pinned`, () => {
      const result = render(factor);
      renders[`${factor}x`] = result;
      expect(result.finite).toBe(true);
      if (refreshing) return;
      const pinned = (golden.renders as Record<string, unknown>)[`${factor}x`];
      const changed = `${factor}x changed (${diagnose(result, factor)}); if intended, run ${REFRESH}`;
      expect(result.pinned, changed).toEqual(pinned);
    });
  }

  it('pins every factor', () => {
    if (refreshing) {
      const table = {
        about:
          'sha256 of the magnetic Tape module rendering a two-second stereo program (tones, a signed pulse, a Drive sweep) at 48 kHz, centre row, through inserts/tapeMagneticGolden.test.ts: the interleaved Float64 output, with each channel guard and reset count. Written only by that test under WINDSOR_REFRESH_TAPE_MAGNETIC_GOLDEN=1, and only when a render change is intended (windsor#219).',
        sampleRate: RATE,
        renders: Object.fromEntries(Object.entries(renders).map(([name, r]) => [name, r.pinned])),
      };
      writeFileSync(TABLE, `${JSON.stringify(table, null, 2)}\n`);
      const record = {
        about: `Every ${STRIDE}th frame of each render inserts/tapeMagneticGolden.test.ts pins, interleaved left and right, as little-endian Float64 in base64. The hash in tapeMagneticGolden.json is the pin; this record only says where a mismatching render first differs and by how much. Written with it, under the same refresh (windsor#219).`,
        stride: STRIDE,
        renders: Object.fromEntries(
          Object.entries(renders).map(([name, r]) => [name, encode(r.record)]),
        ),
      };
      writeFileSync(SAMPLES, `${JSON.stringify(record, null, 2)}\n`);
      return;
    }
    const factors = TAPE_MAGNETIC.factors.map((f) => `${f}x`).sort();
    expect(Object.keys(golden.renders).sort()).toEqual(factors);
    expect(Object.keys(samples.renders).sort()).toEqual(factors);
    expect(samples.stride).toBe(STRIDE);
  });
});

/** The child: evaluate the bundle as a script, warm both factors, read the heap over a measured run. */
const PROBE = `
const { readFileSync, writeFileSync } = require('node:fs');
const v8 = require('node:v8');
const vm = require('node:vm');
const [bundle, out, warm, measure] = process.argv.slice(2);
const api = vm.runInThisContext(readFileSync(bundle, 'utf8') + '\\ntapeMagnetic;', { filename: 'tape-magnetic.js' });
const QUANTUM = 128;
const BANK = 64;
const source = new Float32Array(QUANTUM * BANK);
let seed = 1;
for (let i = 0; i < source.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  source[i] = 3.2 * Math.sin(i * 0.031) + 1.6 * Math.sin(i * 0.29) + (seed / 2 ** 32 - 0.5);
}
const input = new Float32Array(QUANTUM);
const output = new Float32Array(QUANTUM);
// Quanta run in chunks, so the loop that runs them is optimised whole, not only on stack replacement.
function chunks(o, from, to) {
  for (let q = from; q < to; q += 16) quanta(o, q, Math.min(to, q + 16));
}
function quanta(o, from, to) {
  for (let q = from; q < to; q++) {
    const base = (q % BANK) * QUANTUM;
    for (let i = 0; i < QUANTUM; i++) input[i] = source[base + i];
    o.render(input, output, QUANTUM);
  }
}
const result = {};
for (const factor of [2, 4]) {
  const o = new api.TapeOversampler(48000, factor);
  chunks(o, 0, Number(warm));
  gc();
  gc();
  const profiler = new v8.GCProfiler();
  profiler.start();
  v8.getHeapStatistics();
  const before = v8.getHeapStatistics().used_heap_size;
  chunks(o, Number(warm), Number(warm) + Number(measure));
  const after = v8.getHeapStatistics().used_heap_size;
  const gcs = profiler.stop().statistics.length;
  result[factor] = { bytes: after - before, gcs, guards: o.guards, resets: o.core.resets };
}
writeFileSync(out, JSON.stringify(result));
`;

interface ProbeFactor {
  bytes: number;
  gcs: number;
  guards: number;
  resets: number;
}

function probe(): { result: Record<string, ProbeFactor>; changes: string[] } {
  const entry = fileURLToPath(new URL('../worklet/tape/tapeOversample.ts', import.meta.url));
  const bundled = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'tapeMagnetic',
    platform: 'neutral',
    target: 'esnext',
    minify: false,
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  });
  const dir = mkdtempSync(join(tmpdir(), 'tape-magnetic-'));
  try {
    const files = { bundle: join(dir, 'tape-magnetic.js'), probe: join(dir, 'probe.cjs') };
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
        '2000',
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    expect(child.status, child.stderr).toBe(0);
    return {
      result: JSON.parse(readFileSync(out, 'utf8')) as Record<string, ProbeFactor>,
      changes: representationChanges(child.stdout, 'tape-magnetic.js'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the per-sample path on V8', () => {
  it('allocates nothing and changes no field representation at 2x and 4x', () => {
    const { result, changes } = probe();
    expect(changes).toEqual([]);
    for (const factor of ['2', '4']) {
      const run = result[factor]!;
      expect(run.gcs, `${factor}x: no collection ran while the heap was read`).toBe(0);
      expect(run.guards, `${factor}x: the warm-up reached the field guard`).toBeGreaterThan(0);
      expect(run.bytes, `${factor}x`).toBeLessThan(16 * 1024);
    }
  }, 120_000);
});
