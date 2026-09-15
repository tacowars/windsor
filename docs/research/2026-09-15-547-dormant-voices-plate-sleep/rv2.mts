import { performance } from 'node:perf_hooks';
const [root, label, warm] = process.argv.slice(2);
const rv = await import(`${root}/packages/client/src/audio/__fixtures__/reverbHarness.ts`);
const rl = rv.loadReverb();
if (warm === 'impulse') for (let r = 0; r < 3; r++) rv.renderReverb(rl, 60, rv.impulse);
const t: number[] = [];
for (let r = 0; r < 9; r++) { const t0 = performance.now(); rv.renderReverb(rl, 10, rv.noiseBurst(10)); t.push(performance.now() - t0); }
const t2: number[] = [];
for (let r = 0; r < 5; r++) { const t0 = performance.now(); rv.renderReverb(rl, 60, rv.impulse); t2.push(performance.now() - t0); }
console.log(label, warm, 'noise10s median', t.sort((a,b)=>a-b)[4].toFixed(1), 'then impulse60 median', t2.sort((a,b)=>a-b)[2].toFixed(1));
