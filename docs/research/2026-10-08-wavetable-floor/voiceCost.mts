// The voice loop's cost with the sized tables, against a checkout without them.
// Usage: npx tsx docs/research/2026-10-08-wavetable-floor/voiceCost.mts <checkout root> [runs]
// Scenarios: `bass`, a saw and a square bass (alg 4, two carriers) held at
// C1, C2 and C3, which read the 16384-, 8192- and 4096-sample tables; and
// `bank`, the #548 bench's four factory parts at C3, G3 and C4.
// Prints `median <ms>` per scenario, 10 s of audio each.
import { performance } from 'node:perf_hooks';

const [root, runsArg] = process.argv.slice(2);
const fm = await import(`${root}/packages/engine/src/__fixtures__/workletHarness.ts`);
const { FILTER_MODE, makePatch, WAVE } = await import(`${root}/packages/engine/src/patch/patch.ts`);
const { PRESETS } = await import(`${root}/packages/engine/src/patch/presets.ts`);

const RUNS = Number(runsArg ?? 7);
const BLOCKS = Math.round((10 * 48000) / 128);
const loaded = fm.loadProcessor();
const env = { attackTime: 0.001, decayTime: 0.001, sustainLevel: 0.8 };

const bass = makePatch({
  algorithm: 4,
  spread: 0,
  filter: { mode: FILTER_MODE.OFF },
  ops: [
    { wave: WAVE.SAW, level: 1, env },
    { level: 0, env },
    { wave: WAVE.SQUARE, level: 0.8, env },
    { level: 0, env },
  ],
});
function held(id: string) {
  const p = { ...structuredClone(PRESETS[id]), spread: 0 };
  for (const op of p.ops) op.env.sustainLevel = Math.max(op.env.sustainLevel, 0.7);
  return p;
}
const SCENARIOS: Record<string, { patch: unknown; notes: number[] }[]> = {
  bass: [{ patch: bass, notes: [24, 36, 48] }],
  bank: ['pad-drift', 'horde-horn', 'pickup-blip', 'hat'].map((id) => ({ patch: held(id), notes: [48, 55, 60] })),
};

function renderPart(patch: unknown, notes: number[]): number {
  const p = loaded.create(patch, 16);
  const events = notes.map((note, i) => ({ type: 'noteOn', id: i + 1, note, velocity: 0.9, frame: 0 }));
  const t0 = performance.now();
  fm.render(loaded, p, BLOCKS, events, { collectSamples: false });
  return performance.now() - t0;
}

const only = process.env.SCENARIOS?.split(',');
for (const [name, parts] of Object.entries(SCENARIOS)) {
  if (only && !only.includes(name)) continue;
  for (const part of parts) renderPart(part.patch, part.notes); // warm-up
  const totals: number[] = [];
  for (let r = 0; r < RUNS; r++) totals.push(parts.reduce((s, part) => s + renderPart(part.patch, part.notes), 0));
  const med = [...totals].sort((a, b) => a - b)[totals.length >> 1];
  console.log(`${name} median ${med.toFixed(1)} ms [${totals.map((t) => t.toFixed(0)).join(', ')}]`);
}
