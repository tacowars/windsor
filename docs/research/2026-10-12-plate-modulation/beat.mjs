/* global process, console */
// spread @1k, HOLD envelope peak at several tones (and mean), fed envelope @1k.
import { loadPlate, render, sine, envelope, spreadHz, fmt } from './rig.mjs';
import { envWelch } from './envlib.mjs';
const variant = process.argv[2];
const cells = process.argv[3].split(',').map((c) => c.split(':').map(Number));
const tones = (process.argv[4] ?? '250,500,1000,2000').split(',').map(Number);
const rate = 48000;
const blockAt = (s) => Math.round((s * rate) / 128);

function envPeak(L, R, hz) {
  const win = Math.round((rate / hz) * Math.max(1, Math.round(hz / 100)));
  const a = envWelch(envelope(L.subarray(3 * rate, 33 * rate), win), rate / win);
  const b = envWelch(envelope(R.subarray(3 * rate, 33 * rate), win), rate / win);
  return Math.max(a.db, b.db);
}

const plate = loadPlate(variant, rate);
const out = [];
for (const [r, d] of cells) {
  const p = { modRate: r, modDepth: d };
  const s = render(plate, 12, sine(1000), p);
  const spread = spreadHz(s.L.subarray(4 * rate), rate, 1000, 250, 32768);
  const holds = tones.map((hz) => {
    const h = render(plate, 33.5, sine(hz, 0.3, 2), p, (b, v) => (v.hold[0] = b >= blockAt(1.9) ? 1 : 0));
    return envPeak(h.L, h.R, hz);
  });
  const f = render(plate, 33.5, sine(1000), p);
  const mean = holds.reduce((a, b) => a + b, 0) / holds.length;
  out.push(`${variant}\t${r}\t${d}\t${fmt(spread)}\t${holds.map((h) => fmt(h, 1)).join('\t')}\tmean ${fmt(mean, 1)}\tfed ${fmt(envPeak(f.L, f.R, 1000), 1)}`);
}
console.log(out.join('\n'));
