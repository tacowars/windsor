/* global process, console */
// Switching voicing (windsor#746): the largest sample-to-sample step on
// either side from 1 s on, with the voicing flipped at 2 s and back at 3 s
// (and the issue's other switches), against the same feed through a still
// plate in each voicing, as the no-step test of
// `docs/log/2026-08-31-dattorro-reverb-not-plateau.md` §3 reads it. Two feeds:
// a steady 220 Hz tone at 0.3 (whose own slew sets a ceiling, 2π·220/rate ×
// the wet peak × 3, as `mixer/reverbBuild.test.ts` holds), and a drum loop
// (a 0.4 s burst, a kick every 0.5 s, a hat every 0.25 s). Decay 10 s, so a
// tail rings through every switch. `variant` names a patch of the duck,
// `wet` to duck the wet output only (not the tank's feed), `none` to swap at
// once, for the note's comparison.
// node switchSteps.mjs <new bundle> [rate] [variant]
import { BLOCK, loadPlate, render } from '../2026-10-12-plate-stereo-input/rig.mjs';

const [file, rateArg = '48000', variant = 'shipped'] = process.argv.slice(2);
const rate = Number(rateArg);
const PATCHES = {
  shipped: (s) => s,
  wet: (s) =>
    s
      .replace('const splitLeft = buildRight * duck + this._denormal;', 'const splitLeft = buildRight + this._denormal;')
      .replace('const splitRight = buildLeft * duck + this._denormal;', 'const splitRight = buildLeft + this._denormal;'),
  none: (s) => s.replace(/plate\._duckState = DUCK_OUT;/, 'applyVoicing(plate, asked, true); keepSnapshot(plate, parameters); return parameters;'),
};
const plate = loadPlate(file, rate, PATCHES[variant]);
const at = (seconds) => Math.round((seconds * rate) / BLOCK);

const tone = (b, l, r) => {
  for (let i = 0; i < BLOCK; i++) l[i] = r[i] = Math.sin((2 * Math.PI * 220 * (b * BLOCK + i)) / rate) * 0.3;
};
function drums() {
  let seed = 1;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  return (b, l, r) => {
    for (let i = 0; i < BLOCK; i++) {
      const t = (b * BLOCK + i) / rate;
      const beat = t % 0.5;
      let v = t < 0.4 ? noise() * 0.5 : 0;
      if (t >= 0.5) v += Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat / 0.08) * 0.8;
      if (t >= 0.5 && t % 0.25 < 0.004) v += noise() * 0.4;
      l[i] = r[i] = v;
    }
  };
}

/** Largest step from 1 s on, and the wet peak. */
function step(feed, params, automate) {
  const { L, R } = render(plate, 5, params, { feed, automate });
  let s = 0;
  let peak = 0;
  for (const x of [L, R]) {
    for (let i = rate; i < x.length; i++) {
      s = Math.max(s, Math.abs(x[i] - x[i - 1]));
      peak = Math.max(peak, Math.abs(x[i]));
    }
  }
  return { s, peak };
}

const SWITCHES = {
  'plate → room → plate': [0, (b, v) => (v.voicing[0] = b >= at(2) && b < at(3) ? 1 : 0)],
  'room → plate → room': [1, (b, v) => (v.voicing[0] = b >= at(2) && b < at(3) ? 0 : 1)],
  'flip back in the duck': [0, (b, v) => (v.voicing[0] = b === at(2) ? 1 : 0)],
  'with HOLD on': [
    0,
    (b, v) => {
      v.hold[0] = b >= at(1.5) && b < at(3.5) ? 1 : 0;
      v.voicing[0] = b >= at(2) && b < at(3) ? 1 : 0;
    },
  ],
};
const f = (x) => x.toFixed(4);
console.log(`${variant} at ${rate} Hz: step over the still plate's (tone ceiling, drums)\n`);
for (const [name, feed] of [['tone', () => tone], ['drums', drums]]) {
  const still = Math.max(
    ...[0, 1].map((voicing) => step(feed(), { decay: 10, voicing }, () => {}).s),
  );
  for (const [label, [voicing, automate]] of Object.entries(SWITCHES)) {
    const r = step(feed(), { decay: 10, voicing }, automate);
    const ceiling = ((2 * Math.PI * 220) / rate) * r.peak * 3;
    console.log(
      `${name} · ${label}: ${f(r.s)} against still ${f(still)} (${f(r.s / still)})` +
        (name === 'tone' ? `, ceiling ${f(ceiling)} (${f(r.s / ceiling)})` : ''),
    );
  }
}
