/* global process, console */
// The whole box (windsor#761): every interacting control at its ends and
// Build at 0, 0.5 and 1 -- Size 0.05, 1 and 4; diffusionIn1 and
// diffusionIn2 each 0 and 1; preDelay 0 and 1 s; Decay 0.2 and 60 s; HOLD
// off and on -- one click in, at the rate asked. Prints a TSV: the onset
// figures of `buildRig.mjs`, the peak, the non-finite count, and with HOLD
// on (engaged 0.3 s after the click reaches the tank, held to the end) the
// held tail's RMS from 2.5 to 3 s against 0.5 to 1 s, in dB.
// node sweep.mjs <bundle> [rate]
import { BLOCK, SETTLE, loadPlate, onset, render } from './buildRig.mjs';

const [file, rateArg = '48000'] = process.argv.slice(2);
const rate = Number(rateArg);
const plate = loadPlate(file, rate);

const rms = (L, R, from, to) => {
  let e = 0;
  for (let i = Math.round(from * rate); i < Math.round(to * rate); i++)
    e += L[i] * L[i] + R[i] * R[i];
  return Math.sqrt(e / (2 * (Math.round(to * rate) - Math.round(from * rate))));
};

console.log(
  'build\tsize\tdiffIn1\tdiffIn2\tpreDelay\tdecay\thold\tfirst ms\trise ms\tE20\tE100\tRMS 1 s\tpeak\tnon-finite\theld dB',
);
/** Every point of the box, in the order the TSV lists it. */
const AXES = {
  build: [0, 0.5, 1],
  size: [0.05, 1, 4],
  diffusionIn1: [0, 1],
  diffusionIn2: [0, 1],
  preDelay: [0, 1],
  decay: [0.2, 60],
  hold: [0, 1],
};
const points = Object.entries(AXES).reduce(
  (grid, [name, values]) => grid.flatMap((point) => values.map((v) => ({ ...point, [name]: v }))),
  [{}],
);

for (const { hold, ...params } of points) {
  const { preDelay } = params;
  const holdAt = Math.round(((SETTLE + preDelay + 0.3) * rate) / BLOCK);
  const out = render(plate, preDelay + 3, params, {
    automate: (block, values) => {
      values.hold[0] = hold && block >= holdAt ? 1 : 0;
    },
  });
  const o = onset(out, rate, preDelay);
  let peak = 0;
  let bad = 0;
  for (let i = 0; i < out.L.length; i++) {
    if (!Number.isFinite(out.L[i]) || !Number.isFinite(out.R[i])) bad++;
    else peak = Math.max(peak, Math.abs(out.L[i]), Math.abs(out.R[i]));
  }
  const held = hold
    ? (
        20 *
        Math.log10(
          rms(out.L, out.R, preDelay + 2.5, preDelay + 3) /
            rms(out.L, out.R, preDelay + 0.5, preDelay + 1),
        )
      ).toFixed(1)
    : '-';
  console.log(
    [
      params.build,
      params.size,
      params.diffusionIn1,
      params.diffusionIn2,
      preDelay,
      params.decay,
      hold ? 'on' : 'off',
      o.firstMs.toFixed(2),
      o.riseMs.toFixed(0),
      o.e20.toFixed(4),
      o.e100.toFixed(4),
      o.rms1s.toExponential(2),
      peak.toFixed(3),
      bad,
      held,
    ].join('\t'),
  );
}
