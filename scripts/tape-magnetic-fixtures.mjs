/**
 * Writes `packages/engine/src/__fixtures__/tapeMagneticReference.json`, the
 * research ruler the magnetic Tape core is tested against (windsor#219).
 *
 * This is the one shipping-side file that touches `docs/research/`, and only
 * here, at fixture-generation time: it loads the research core through the
 * research loader (`docs/research/2026-09-30-tape-phase-3/load.mjs`),
 * read-only, and runs it. Nothing under `packages/` imports the research,
 * and no test or build runs this script.
 *
 * What it writes, for the test to need nothing from `docs/research/`:
 *
 * - The synthetic oversampled source-field sequences, H and its exact time
 *   derivative at every RK4 stage point (each step's start, midpoint and end)
 *   of `steps` steps at 48 kHz × 4: the three tones of the research
 *   `EXPERIMENT.bins` at level 1, and a signed ±4 raised-cosine pulse.
 * - For the research centre and the eight control-cube corners, the research
 *   core's magnetization after every `stride`-th step on each sequence, with
 *   the research knee conditioning (`condition`, policy `knee`) applied at
 *   every stage and its RK4 `step`. The research aborts on a state past its
 *   guard; the script refuses to write a fixture if any case does.
 * - The research `condition` on a grid over [−8, 8]: field and slope.
 * - The SHA-256 of every research source the loader bundled.
 *
 * Float64 arrays are stored as little-endian base64. The file is formatted
 * with the repository's Prettier config, so a run on Node 24 regenerates it
 * byte for byte; `--check` compares instead of writing.
 *
 *   node scripts/tape-magnetic-fixtures.mjs [--check]
 */
/* global process, Buffer, console */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import * as prettier from 'prettier';
import { loadSource } from '../docs/research/2026-09-30-tape-phase-3/load.mjs';

const OUTPUT = 'packages/engine/src/__fixtures__/tapeMagneticReference.json';
const LOADER = 'docs/research/2026-09-30-tape-phase-3/load.mjs';
const ENTRY = `
export { configured, condition, stage } from './docs/research/2026-09-30-tape-conditioning/conditioning.ts';
export { step } from './docs/research/2026-09-30-tape-filtered-reference/filteredReference.ts';
export { EXPERIMENT } from './docs/research/2026-09-30-tape-phase-3/experimentConstants.ts';`;

const RATE = 48000;
const FACTOR = 4;
const STEPS = 8192;
const STRIDE = 4;
const POLICY = 'knee';
const SOLVER = 'rk4';
const PULSE = { level: 4, stepsWide: 192, firstStep: 1024, secondStep: 4096 };
const GRID = { from: -8, to: 8, perUnit: 64 };
const CENTRE = [0.5, 0.5, 0.5];
const CORNERS = [0, 1].flatMap((d) => [0, 1].flatMap((w) => [0, 1].map((s) => [d, w, s])));

const encode = (values) => Buffer.from(Float64Array.from(values).buffer).toString('base64');

/** The stage points' times: 2 × steps + 1 of them, half an oversampled step apart. */
function stageTimes() {
  const dt = 1 / (2 * RATE * FACTOR);
  return Array.from({ length: 2 * STEPS + 1 }, (_, p) => p * dt);
}

function tone(bin, frames) {
  const w = (2 * Math.PI * bin * RATE) / frames;
  const times = stageTimes();
  return {
    name: `tone-${bin}`,
    h: times.map((t) => Math.sin(w * t)),
    dh: times.map((t) => w * Math.cos(w * t)),
  };
}

/** +level then −level, each a raised-cosine lobe `stepsWide` oversampled steps long. */
function pulse() {
  const width = 2 * PULSE.stepsWide;
  const seconds = PULSE.stepsWide / (RATE * FACTOR);
  const h = [];
  const dh = [];
  for (let p = 0; p <= 2 * STEPS; p++) {
    const lobe = [PULSE.firstStep, PULSE.secondStep].findIndex(
      (step) => p >= 2 * step && p < 2 * step + width,
    );
    const u = lobe < 0 ? 0 : (p - 2 * [PULSE.firstStep, PULSE.secondStep][lobe]) / width;
    const sign = lobe === 1 ? -1 : 1;
    h.push(lobe < 0 ? 0 : (sign * PULSE.level * (1 - Math.cos(2 * Math.PI * u))) / 2);
    dh.push(lobe < 0 ? 0 : (sign * PULSE.level * Math.PI * Math.sin(2 * Math.PI * u)) / seconds);
  }
  return { name: 'pulse-4', h, dh };
}

/** The research trajectory: its knee on every stage point, its RK4 step, every `STRIDE`-th state. */
function trajectory(research, controls, input) {
  const core = research.configured(RATE * FACTOR, controls, POLICY);
  const dt = 1 / (RATE * FACTOR);
  const states = [];
  for (let i = 0; i < STEPS; i++) {
    const points = [];
    for (let j = 0; j < 3; j++)
      points.push(...research.stage(input.h[2 * i + j], input.dh[2 * i + j], POLICY));
    research.step(core, points, dt, SOLVER);
    if ((i + 1) % STRIDE === 0) states.push(core.m);
  }
  return states;
}

async function sourceHashes() {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    write: false,
    metafile: true,
    format: 'cjs',
    platform: 'node',
    target: 'esnext',
  });
  const paths = [LOADER, ...Object.keys(result.metafile.inputs).filter((p) => p !== '<stdin>')];
  const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  return Object.fromEntries(paths.sort().map((path) => [path, sha(path)]));
}

function conditionGrid(research) {
  const h = [];
  for (let i = GRID.from * GRID.perUnit; i <= GRID.to * GRID.perUnit; i++) h.push(i / GRID.perUnit);
  const pairs = h.map((value) => research.condition(value, POLICY));
  return {
    h: encode(h),
    field: encode(pairs.map((p) => p[0])),
    slope: encode(pairs.map((p) => p[1])),
  };
}

async function fixture() {
  const research = await loadSource(ENTRY);
  const { bins, frames } = research.EXPERIMENT;
  const inputs = [...bins.map((bin) => tone(bin, frames)), pulse()];
  const controls = [CENTRE, ...CORNERS];
  const trajectories = controls.flatMap((row, c) =>
    inputs.map((input, i) => ({
      controls: c,
      input: i,
      m: encode(trajectory(research, row, input)),
    })),
  );
  return {
    about:
      'The research ruler for the magnetic Tape core (windsor#219): synthetic oversampled source fields (H, dH at every RK4 stage point) and the research core trajectory on each, with its knee conditioning, for the centre and the eight control corners; and its knee on a grid. Written by scripts/tape-magnetic-fixtures.mjs from the research sources hashed here; never edited by hand. Float64 arrays are little-endian base64.',
    command: 'node scripts/tape-magnetic-fixtures.mjs',
    sources: await sourceHashes(),
    rate: RATE,
    factor: FACTOR,
    steps: STEPS,
    stride: STRIDE,
    policy: POLICY,
    solver: SOLVER,
    controls: controls.map(([drive, width, saturation]) => ({ drive, width, saturation })),
    inputs: inputs.map(({ name, h, dh }) => ({ name, h: encode(h), dh: encode(dh) })),
    trajectories,
    condition: conditionGrid(research),
  };
}

async function main() {
  if (
    resolve(process.cwd(), 'scripts/tape-magnetic-fixtures.mjs') !==
    resolve(import.meta.dirname, 'tape-magnetic-fixtures.mjs')
  )
    throw new Error('run from the repository root');
  const options = { ...(await prettier.resolveConfig(OUTPUT)), parser: 'json' };
  const text = await prettier.format(JSON.stringify(await fixture()), options);
  if (process.argv.includes('--check')) {
    const same = readFileSync(OUTPUT, 'utf8') === text;
    console.log(same ? `${OUTPUT} is current` : `${OUTPUT} differs from a fresh run`);
    process.exitCode = same ? 0 : 1;
    return;
  }
  writeFileSync(OUTPUT, text);
  console.log(`wrote ${OUTPUT}`);
}

await main();
