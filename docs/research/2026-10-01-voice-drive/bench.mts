// windsor#300 dev-machine microbench: the FM voice loop with the drive stage
// off and on. The #548 bench (`2026-09-15-548-fm-voice-loop-specialisation`),
// moved to today's paths and given a drive per scenario.
// Usage: npx tsx bench.mts <checkout root> <label> [runs]
// Four parts, three held notes each, rendered one after another for 10 s of
// audio. Every carrier sustains above 0, so dormancy never engages and the
// loop runs for the whole render. Each part keeps its filter on, as the
// factory patches do; a scenario sets both drive spellings, `filter.drive`
// (read before windsor#300) and `drive` (read after), so one script measures
// both checkouts and each reads only its own.
import { performance } from 'node:perf_hooks';

const [root, label, runsArg] = process.argv.slice(2);
const fm = await import(`${root}/packages/engine/src/__fixtures__/workletHarness.ts`);
const { PRESETS } = await import(`${root}/packages/engine/src/patch/presets.ts`);

const SR = 48000;
const SECONDS = 10;
const RUNS = Number(runsArg ?? 9);
const BLOCKS = Math.round((SECONDS * SR) / 128);

type Drive = { gain: number; shape: number; bias: number; tone: number };
type Raw = { filter: object; ops: { env: { sustainLevel: number } }[]; drive?: Drive };

/** A factory preset with `spread` 0, so one note is one voice, and the scenario's drive. */
function single(id: string, drive: Drive): Raw {
  const p = { ...structuredClone(PRESETS[id]), spread: 0 } as Raw;
  p.filter = { ...p.filter, drive: drive.gain };
  p.drive = drive;
  return p;
}

/** The same, with every operator's sustain raised to `level`, so it holds. */
function sustained(id: string, level: number, drive: Drive): Raw {
  const p = single(id, drive);
  for (const op of p.ops) op.env.sustainLevel = level;
  return p;
}

const parts = (drive: Drive) => [
  { name: 'pad-drift (alg 4, 4 ops)', patch: single('pad-drift', drive) },
  { name: 'horde-horn (alg 1, 3 ops)', patch: single('horde-horn', drive) },
  { name: 'pickup-blip sus 0.7 (alg 0, 2 ops)', patch: sustained('pickup-blip', 0.7, drive) },
  { name: 'hat sus 0.7 (alg 7 additive, 3 ops)', patch: sustained('hat', 0.7, drive) },
];

const SCENARIO: Record<string, Drive> = {
  bypassed: { gain: 1, shape: 0, bias: 0, tone: 1 },
  soft: { gain: 1.5, shape: 0, bias: 0, tone: 1 },
  'soft+bias+tone': { gain: 1.5, shape: 0, bias: 0.2, tone: 0.5 },
  hard: { gain: 1.5, shape: 1, bias: 0.2, tone: 1 },
  diode: { gain: 1.5, shape: 2, bias: 0.2, tone: 1 },
  tube: { gain: 1.5, shape: 3, bias: 0.2, tone: 1 },
  fold: { gain: 1.5, shape: 4, bias: 0.2, tone: 1 },
};
const NOTES = [48, 55, 60];

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const loaded = fm.loadProcessor();

function renderPart(patch: unknown): number {
  const p = loaded.create(patch, 16);
  const events = NOTES.map((note, i) => ({ type: 'noteOn', id: i + 1, note, velocity: 0.9, frame: 0 }));
  const t0 = performance.now();
  fm.render(loaded, p, BLOCKS, events, { collectSamples: false });
  const dt = performance.now() - t0;
  const held = p.voices.filter((v: { active: boolean }) => v.active).length;
  if (held !== NOTES.length) throw new Error(`expected ${NOTES.length} held voices, got ${held}`);
  return dt;
}

const only = process.env.SCENARIOS?.split(',');
for (const [name, drive] of Object.entries(SCENARIO)) {
  if (only && !only.includes(name)) continue;
  const list = parts(drive);
  for (const part of list) renderPart(part.patch); // warm-up
  const totals: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    let total = 0;
    for (const part of list) total += renderPart(part.patch);
    totals.push(total);
  }
  console.log(
    `${label} ${name}: median ${median(totals).toFixed(1)} ms [${totals.map((t) => t.toFixed(0)).join(',')}]`,
  );
}
