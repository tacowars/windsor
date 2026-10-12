/* global process, console */
import { loadPlate, render, sine, spreadHz, fmt } from './rig.mjs';
const variants = process.argv[2].split(',');
const rates = (process.argv[3] ?? '0.1,0.25,0.5,1,2,4,8').split(',').map(Number);
const depths = (process.argv[4] ?? '0,0.25,0.5,0.7,1,2,4').split(',').map(Number);
const rate = Number(process.argv[5] ?? 48000);
for (const v of variants) {
  const plate = loadPlate(v, rate);
  console.log(`\n${v}: spread Hz (rows depth ms, cols rate Hz)`);
  console.log('depth\\rate\t' + rates.join('\t'));
  for (const d of depths) {
    const row = [];
    for (const r of rates) {
      const { L } = render(plate, 12, sine(1000), { modRate: r, modDepth: d });
      row.push(fmt(spreadHz(L.subarray(4 * rate), rate, 1000, 250, 32768), 2));
    }
    console.log(`${d}\t\t` + row.join('\t'));
  }
}
