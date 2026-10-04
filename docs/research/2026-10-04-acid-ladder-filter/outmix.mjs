/* global console */
/**
 * The output mix in the linear model (windsor#577): the TB-303's second
 * resonance path, the Reso pot's wiper into the VCA through 10 nF / 100 kΩ
 * beside the ladder output's 10 nF / 220 kΩ (C21, C22 and R121 by IC15 on
 * the service notes' schematic), as y_out = y (1 + m p Rout(s)), Rout the
 * one-pole high-pass s / (s + ω_out), around the loop 1 / (D(s) + k Rloop(s))
 * with k = KMAX p. For each variant and each of the ACB comparison's four
 * Cut Off sections (windsor#574's Cut Off map, and the ACB's lift and
 * 55 Hz bass loss at 100 % and 50 % from `reference/compare.txt`) it prints
 * the predicted emphasis lift and bass loss at p = 1 and 0.5.
 *
 * Provenance: written in the main session while windsor#577 was planned
 * (that session's scratchpad `outmix.mjs`), copied here unchanged below this
 * header but for two lint comments. Linear only: the shipped solver's input pair saturates and caps
 * the loop's lift, so these lifts overshoot what the rig reads.
 *
 *   node outmix.mjs
 */
// Linear model with the output mix: y_out = y * (1 + m * p * Rout(s)), Rout = s/(s + w_out).
// Loop: -1/(D(s) + k * Rloop(s)), k = KMAX * p. Lift = |H_out| at the emphasis vs the 0 % response there.
const D = [1, 4 * Math.pow(2, 0.75), 10 * Math.SQRT2, 8 * Math.pow(2, 0.25), 1];
const cm = (a, b) => [a[0]*b[0]-a[1]*b[1], a[0]*b[1]+a[1]*b[0]];
const ca = (a, b) => [a[0]+b[0], a[1]+b[1]];
const cd = (a, b) => { const d = b[0]*b[0]+b[1]*b[1]; return [(a[0]*b[0]+a[1]*b[1])/d, (a[1]*b[0]-a[0]*b[1])/d]; };
const cabs = (a) => Math.hypot(a[0], a[1]);
const pe = (c, s) => c.reduce((acc, v) => ca(cm(acc, s), [v, 0]), [0, 0]);
const hp = (f, fp) => { const s = [0, f]; return cd(s, ca(s, [fp, 0])); };
// eslint-disable-next-line max-params -- the planning script as written (see the header): one transfer function
function Hdb(f, fc, k, loopHz, p, m, outHz) {
  const s = [0, f / fc];
  const loop = cd([1, 0], ca(pe(D, s), cm([k, 0], hp(f, loopHz))));
  const mix = ca([1, 0], cm([m * p, 0], hp(f, outHz)));
  return 20 * Math.log10(cabs(cm(loop, mix)));
}
const ACB = { sections: [[199, 13.6, -12.2, 6.8, -9.3], [314, 17.9, -13.1, 7.4, -10.3], [630, 20.5, -13.1, 9.1, -10.5], [1465, 27.2, -12.1, 10.6, -9.6]] };
for (const [label, KMAX, loopHz, m, outHz] of [
  ['no mix, loop 100 (today)', 16.5, 100, 0, 160],
  ['mix 2.2 @160, loop 100', 16.5, 100, 2.2, 160],
  ['mix 2.2 @160, loop 50', 16.5, 50, 2.2, 160],
  ['mix 1.5 @160, loop 100', 16.5, 100, 1.5, 160],
  ['mix 2.2 @160, loop 100, k 17', 17, 100, 2.2, 160],
  ['mix 2.2 @100, loop 100', 16.5, 100, 2.2, 100],
  ['mix 3 @160, loop 150', 16.5, 150, 3, 160],
]) {
  console.log(`\n${label}`);
  for (const [fc, acbLift, acbBass, acbLift50, acbBass50] of ACB.sections) {
    const row = [];
    for (const p of [1, 0.5]) {
      const k = KMAX * p;
      let best = -1e9, bf = 0;
      // eslint-disable-next-line max-depth -- the planning script as written (see the header): one peak search
      for (let f = fc * 0.5; f < fc * 2.5; f *= 1.002) { const v = Hdb(f, fc, k, loopHz, p, m, outHz); if (v > best) { best = v; bf = f; } }
      const lift = best - Hdb(bf, fc, 0, loopHz, 0, m, outHz);
      const bass = Hdb(55, fc, k, loopHz, p, m, outHz) - Hdb(55, fc, 0, loopHz, 0, m, outHz);
      row.push(`${p === 1 ? '100%' : ' 50%'}: lift ${lift.toFixed(1).padStart(5)} (ACB ${(p === 1 ? acbLift : acbLift50).toFixed(1)}) bass55 ${bass.toFixed(1).padStart(6)} (ACB ${(p === 1 ? acbBass : acbBass50).toFixed(1)})`);
    }
    console.log(`  fc ${String(fc).padStart(4)}  ${row.join('   ')}`);
  }
}
