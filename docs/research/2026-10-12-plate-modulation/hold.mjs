/* global process, console */
// HOLD steadiness by the tank's stored energy (lines 4..11 within their lengths) and the wet level.
import { loadPlate, render, sine, fmt } from './rig.mjs';
const variants = process.argv[2].split(',');
const cells = process.argv[3].split(',').map((c) => c.split(':').map(Number));
const tones = (process.argv[4] ?? '40,220,1000').split(',').map(Number);
const rate = Number(process.argv[5] ?? 48000);
const extra = JSON.parse(process.argv[6] ?? '{}');
const blockAt = (s) => Math.round((s * rate) / 128);

function tankEnergy(p) {
  let e = 0;
  for (let line = 4; line < 12; line++) {
    const buf = p._buffers[line];
    const mask = p._mask[line];
    const n = Math.floor(p._length[line]);
    for (let k = 1; k <= n; k++) e += buf[(p._write[line] - k) & mask] ** 2;
  }
  return e;
}

const runs = variants.flatMap((v) => cells.flatMap(([r, d]) => tones.map((hz) => ({ v, r, d, hz }))));
for (const { v, r, d, hz } of runs) {
  const plate = loadPlate(v, rate);
  const energies = [];
  const { L, R } = render(plate, 64, sine(hz, 0.3, 2), { modRate: r, modDepth: d, ...extra }, (b, values, p) => {
    values.hold[0] = b >= blockAt(1.9) ? 1 : 0;
    if (b >= blockAt(3) && b % blockAt(0.5) === 0) energies.push(tankEnergy(p));
  });
  const db = energies.map((e) => 10 * Math.log10(e / energies[0]));
  const levels = [];
  for (let t = 3; t + 5 <= 63; t += 5) {
    let e = 0;
    for (let i = t * rate; i < (t + 5) * rate; i++) e += L[i] ** 2 + R[i] ** 2;
    levels.push(10 * Math.log10(e / (5 * rate)));
  }
  const wet = levels.map((l) => l - levels[0]);
  if (process.env.TRACE) console.log('  tank every 5 s: ' + db.filter((_, i) => i % 10 === 0).map((x) => fmt(x, 2)).join(' '));
  console.log(
    `${v} ${r}Hz/${d}ms ${hz}Hz: tank ${fmt(Math.min(...db), 2)}..${fmt(Math.max(...db), 2)} dB (60 s: ${fmt(db.at(-1), 2)})` +
      ` | wet 5s ${fmt(Math.min(...wet), 2)}..${fmt(Math.max(...wet), 2)} (last ${fmt(wet.at(-1), 2)})`,
  );
}
