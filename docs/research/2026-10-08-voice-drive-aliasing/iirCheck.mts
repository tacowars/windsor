// The IIR halfband's realised response, measured: a sine through up, then
// (a) the image's level at the 2x rate and (b) the round trip's gain.
// Usage: npx tsx docs/research/2026-10-08-voice-drive-aliasing/iirCheck.mts
import { HB, IIR, iirDown2, iirUp2, up2, down2 } from './shapers.mts';

const SR = 48000;
const L = 1 << 15;
function tone(f: number): Float64Array {
  return Float64Array.from({ length: L }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR));
}
/** Amplitude at f in v (rate sr), by correlation over the second half. */
function amp(v: Float64Array, f: number, sr: number): number {
  let re = 0, im = 0, n = 0;
  for (let i = v.length >> 1; i < v.length; i++, n++) {
    re += v[i] * Math.cos((2 * Math.PI * f * i) / sr);
    im += v[i] * Math.sin((2 * Math.PI * f * i) / sr);
  }
  return (2 * Math.hypot(re, im)) / n;
}
const db = (a: number) => (20 * Math.log10(a)).toFixed(2);
console.log('IIR coefficients', Array.from(IIR).map((c) => c.toFixed(6)).join(', '));
console.log('f (Hz)   IIR image dB   IIR round trip dB   FIR image dB   FIR round trip dB');
for (const f of [1000, 5000, 10000, 15000, 18000, 20000, 21000, 22000, 23000]) {
  const x = tone(f);
  const ui = iirUp2(x, IIR), uf = up2(x, HB);
  console.log(
    `${String(f).padStart(6)}   ${db(amp(ui, SR - f, 2 * SR)).padStart(12)}   ${db(amp(iirDown2(ui, IIR), f, SR)).padStart(17)}   ${db(amp(uf, SR - f, 2 * SR)).padStart(12)}   ${db(amp(down2(uf, HB), f, SR)).padStart(17)}`,
  );
}
