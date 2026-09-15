// #548 dev-machine microbench: the FM voice loop on 12 held, audible voices.
// Usage: [SPECIALISE=0] npx tsx bench.mts <checkout root> <label> [runs]
// SPECIALISE=0 builds every part with `specialise: false` (a #548 checkout only).
// Four parts, three held notes each, rendered one after another for 10 s of
// audio. Every carrier sustains above 0, so #547's dormancy never engages and
// the loop runs for the whole render.
import { performance } from 'node:perf_hooks';

const [root, label, runsArg] = process.argv.slice(2);
const fm = await import(`${root}/packages/client/src/audio/__fixtures__/workletHarness.ts`);
const { PRESETS } = await import(`${root}/packages/client/src/audio/presets.ts`);

const SR = 48000;
const SECONDS = 10;
const RUNS = Number(runsArg ?? 9);
const CREATE_OPTIONS = process.env.SPECIALISE === '0' ? { specialise: false } : {};
const BLOCKS = Math.round((SECONDS * SR) / 128);

/** A factory preset with `spread` 0, so one note is one voice. */
function single(id: string) {
  return { ...structuredClone(PRESETS[id]), spread: 0 };
}

/** The same, with every operator's sustain raised to `level`, so it holds. */
function sustained(id: string, level: number) {
  const p = single(id);
  for (const op of p.ops) op.env.sustainLevel = level;
  return p;
}

const PARTS = [
  // all four operators, algorithm 4 (two 2-op stacks), factory, spread 0
  { name: 'pad-drift (alg 4, 4 ops)', patch: single('pad-drift') },
  // three operators, algorithm 1, op D at level 0, factory, spread 0
  { name: 'horde-horn (alg 1, 3 ops)', patch: single('horde-horn') },
  // two operators, algorithm 0, ops C and D at level 0; sustain raised
  { name: 'pickup-blip sus 0.7 (alg 0, 2 ops)', patch: sustained('pickup-blip', 0.7) },
  // additive, algorithm 7, op D at level 0; sustain raised
  { name: 'hat sus 0.7 (alg 7 additive, 3 ops)', patch: sustained('hat', 0.7) },
];
const NOTES = [48, 55, 60];

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const loaded = fm.loadProcessor();

function renderPart(patch: unknown): number {
  const p = loaded.create(patch, 16, undefined, CREATE_OPTIONS);
  const events = NOTES.map((note, i) => ({ type: 'noteOn', id: i + 1, note, velocity: 0.9, frame: 0 }));
  const t0 = performance.now();
  fm.render(loaded, p, BLOCKS, events, { collectSamples: false });
  const dt = performance.now() - t0;
  const held = p.voices.filter((v: { active: boolean }) => v.active).length;
  if (held !== NOTES.length) throw new Error(`expected ${NOTES.length} held voices, got ${held}`);
  return dt;
}

// Warm-up: one render of every part, so the first timed part does not pay the JIT.
for (const part of PARTS) renderPart(part.patch);

const perPart = PARTS.map(() => [] as number[]);
const totals: number[] = [];
for (let r = 0; r < RUNS; r++) {
  let total = 0;
  PARTS.forEach((part, i) => {
    const t = renderPart(part.patch);
    perPart[i].push(t);
    total += t;
  });
  totals.push(total);
}
PARTS.forEach((part, i) => console.log(`${label} ${part.name}: median ${median(perPart[i]).toFixed(1)} ms`));
console.log(`${label} scenario total (12 voices, ${SECONDS} s): median ${median(totals).toFixed(1)} ms [${totals.map((t) => t.toFixed(0)).join(',')}]`);
