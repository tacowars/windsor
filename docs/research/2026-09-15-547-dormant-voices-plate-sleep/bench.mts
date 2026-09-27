// #547 dev-machine timing: before = the base checkout's worklets, after = this branch's.
import { performance } from 'node:perf_hooks';
const [harnessRoot, label] = process.argv.slice(2);
const fm = await import(`${harnessRoot}/packages/client/src/audio/__fixtures__/workletHarness.ts`);
const rv = await import(`${harnessRoot}/packages/client/src/audio/__fixtures__/reverbHarness.ts`);
const { makePatch } = await import(`${harnessRoot}/packages/client/src/audio/patch.ts`);
const { PRESETS } = await import(`${harnessRoot}/packages/client/src/audio/presets.ts`);
const PRESET = process.env.PRESET ?? 'pluck';
const patch = PRESETS[PRESET] ?? makePatch();
const SR = 48000, SECONDS = 10, VOICES = 16, NOTES = 8, RUNS = 7;
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
const loaded = fm.loadProcessor();
const fmTimes: number[] = [];
for (let r = 0; r < RUNS; r++) {
  const p = loaded.create(patch, VOICES);
  const events = Array.from({ length: NOTES }, (_, i) => ({ type: 'noteOn', id: i + 1, note: 48 + i * 3, velocity: 0.9, frame: 0 }));
  const t0 = performance.now();
  fm.render(loaded, p, Math.round((SECONDS * SR) / 128), events, { collectSamples: false });
  fmTimes.push(performance.now() - t0);
}
const rl = rv.loadReverb();
const rvTimes: number[] = [];
for (let r = 0; r < RUNS; r++) {
  const t0 = performance.now();
  rv.renderReverb(rl, 60, rv.impulse);
  rvTimes.push(performance.now() - t0);
}
const noiseTimes: number[] = [];
for (let r = 0; r < RUNS; r++) {
  const t0 = performance.now();
  rv.renderReverb(rl, 10, rv.noiseBurst(10));
  noiseTimes.push(performance.now() - t0);
}
console.log(`${label} plate noise 10s (never quiet): median ${median(noiseTimes).toFixed(1)} ms`);
console.log(`${label} preset=${PRESET} held ${NOTES} notes ${SECONDS}s: median ${median(fmTimes).toFixed(1)} ms [${fmTimes.map((t) => t.toFixed(0)).join(',')}]; plate impulse+60s: median ${median(rvTimes).toFixed(1)} ms [${rvTimes.map((t) => t.toFixed(0)).join(',')}]`);
