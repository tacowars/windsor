/* global URL, process, console */
// RV-5: Density's loudness match for Low decay's low band, measured. Offline in Node on a bundle.
//
//   node rv5-density-level.mjs fit [bundle.js] [i/n]           the low band's table (one line a node)
//   node rv5-density-level.mjs check [bundle.js] [grid] [i/n]  Density 1 against 0, in dB
//
// With Low decay, the tank's low band decays over Decay × Low decay (0.05 to 80 s) and is matched
// on its own (`worklet/retro/retroLowBand.ts`), from `RETRO_REVERB_DENSITY_LOW_LEVEL`. Probes as
// in `rv3-density-level.mjs`: an impulse and three pooled 100 ms white-noise bursts, Mix 1,
// Character 0, Diffusion 0.7, Density 0 and 1, but rendered for the whole tail (3 s plus three
// quarters of the band's decay, 60 s at most) rather than 6 s.
//
// `fit` sets each node (Tone, Size, the low band's decay D) at Low cross 300 Hz, with Low decay 4
// and Decay D / 4 where D / 4 is a valid Decay (D ≥ 0.8 s), and Low decay 0.25 and Decay 4D
// below. It starts from the RV-3 table's E at (Tone, Size, D), the band's E were it today's tank
// at D, and keeps it unless a probe reads more than 0.7 dB off Density 0, then moves it (in its
// log, by bisection on the rendered level) just far enough, or to where the probes' mean is 0 dB
// when no value holds both. `check` renders Density 0 and 1 over a grid and prints each setting's
// four readings (impulse L, R, bursts L, R). The scripts in this folder run from the checkout.
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const args = process.argv.slice(2);
const mode = args[0] ?? 'check';
const bundleArg = args[1];
const gridName = mode === 'fit' ? 'nodes' : (args[2] ?? 'low');
const [shard, shards] = (args[mode === 'fit' ? 2 : 3] ?? '0/1').split('/').map(Number);
const bundle =
  bundleArg && bundleArg !== '-'
    ? bundleArg
    : new URL('packages/engine/src/worklet/generated/retro-reverb-processor.js', root);
const source = readFileSync(bundle, 'utf8');
let Processor;
class Base {
  port = { onmessage: null, postMessage() {} };
}
const LEVEL = new Function(
  'AudioWorkletProcessor',
  'sampleRate',
  'registerProcessor',
  `${source}\nreturn RETRO_REVERB_DENSITY_LEVEL;`,
)(Base, 48000, (_name, ctor) => {
  Processor = ctor;
});

const RATE = 48000;
const BAND = 0.7;
const GRIDS = {
  nodes: {
    tone: [800, 1500, 2500, 4200, 9000],
    size: [0.25, 0.5, 1, 3, 10],
    decay: [0.05, 0.2, 0.5, 1.4, 2, 6, 20, 80],
  },
  low: {
    tone: [800, 2500, 9000],
    size: [0.25, 1, 10],
    decay: [0.2, 1.4, 5, 20],
    lowDecay: [0.25, 1, 4],
    lowCross: [80, 300, 2000],
  },
  between: {
    tone: [1100, 4200],
    size: [0.5, 3],
    decay: [0.5, 2, 12],
    lowDecay: [0.4, 2.5],
    lowCross: [150, 900],
  },
};

function noise(seed) {
  let s = seed >>> 0;
  return Float32Array.from({ length: RATE * 0.1 }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296 - 0.5) * 0.8;
  });
}
const PROBES = [Float32Array.of(0.8), noise(12345), noise(777), noise(4242)];

/** Each channel's energy; `inverse`, if given, holds the low band's 1 / E per channel. */
function render(spec, probe, seconds, inverse) {
  const params = Object.fromEntries(
    Processor.parameterDescriptors.map((d) => [d.name, new Float32Array([d.defaultValue])]),
  );
  for (const [k, v] of Object.entries({ mix: 1, character: 0, diffusion: 0.7, ...spec }))
    params[k] = new Float32Array([v]);
  const node = new Processor({
    parameterData: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]])),
  });
  if (inverse)
    node.dsp.tank.low.level.match = function () {
      this.left = inverse[0];
      this.right = inverse[1];
    };
  const input = [new Float32Array(128), new Float32Array(128)];
  const output = [new Float32Array(128), new Float32Array(128)];
  const energy = [0, 0];
  for (let frame = 0; frame < RATE * seconds; frame += 128) {
    for (let i = 0; i < 128; i++) input[0][i] = input[1][i] = probe[frame + i] ?? 0;
    node.process([input], [output], params);
    for (let c = 0; c < 2; c++) for (const v of output[c]) energy[c] += v * v;
  }
  return energy;
}

// The whole tail: the ends line up over many passes, so a short window reads a long decay low.
const secondsFor = (spec) => Math.min(60, 3 + 0.75 * spec.decay * spec.lowDecay);
/** Per probe, [impulse, pooled bursts], each channel's energy. */
function energies(spec, inverse) {
  const seconds = secondsFor(spec);
  const each = PROBES.map((probe) => render(spec, probe, seconds, inverse));
  const bursts = [0, 1].map((c) => each[1][c] + each[2][c] + each[3][c]);
  return [each[0], bursts];
}
/** Density 1 over 0 in dB: impulse L, R, bursts L, R. */
function levels(spec, inverse, quiet = energies({ ...spec, density: 0 })) {
  const loud = energies({ ...spec, density: 1 }, inverse);
  return [0, 1].flatMap((p) => [0, 1].map((c) => 10 * Math.log10(loud[p][c] / quiet[p][c])));
}

/** RV-3's E at a node (its table holds Decay 0.2 to 20; outside, its edge). */
function rv3E(tone, size, decay, c) {
  const at = (axis, v) =>
    LEVEL[axis].indexOf(Math.min(Math.max(v, LEVEL[axis][0]), LEVEL[axis].at(-1)));
  const table = c ? LEVEL.right : LEVEL.left;
  const d = LEVEL.decay.includes(decay)
    ? at('decay', decay)
    : decay < 1
      ? 0
      : LEVEL.decay.length - 1;
  return table[at('tone', tone)][at('size', size)][d];
}

/** The low band's E for both channels at a node. */
function fitNode(tone, size, decay) {
  const lowDecay = decay >= 0.8 ? 4 : 0.25;
  const spec = { tone, size, decay: decay / lowDecay, lowDecay, lowCross: 300 };
  const quiet = energies({ ...spec, density: 0 });
  const start = [0, 1].map((c) => rv3E(tone, size, decay, c));
  const read = (e) => levels(spec, [1 / e[0], 1 / e[1]], quiet);
  const first = read(start);
  const result = [];
  for (const c of [0, 1]) {
    const mine = (dbs) => [dbs[c], dbs[c + 2]];
    if (Math.max(...mine(first).map(Math.abs)) <= BAND) {
      result.push(start[c]);
      continue;
    }
    // A larger E turns the ends up less, so Density 1 reads louder: bisect log E.
    const loud = Math.max(...mine(first)) > BAND;
    const target = (dbs) => (loud ? Math.max(...dbs) - BAND : Math.min(...dbs) + BAND);
    let lo = Math.log(start[c]) + (loud ? -Math.log(8) : 0),
      hi = Math.log(start[c]) + (loud ? 0 : Math.log(8));
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      const e = [...start];
      e[c] = Math.exp(mid);
      const t = target(mine(read(e)));
      if (t > 0) hi = mid;
      else lo = mid;
    }
    let value = Math.exp((lo + hi) / 2);
    // No value holds both probes within the band: the one whose readings' mean is 0 dB.
    const e = [...start];
    e[c] = value;
    const dbs = mine(read(e));
    if (Math.max(...dbs.map(Math.abs)) > BAND + 0.05) {
      let a = Math.log(start[c]) - Math.log(8),
        b = Math.log(start[c]) + Math.log(8);
      for (let i = 0; i < 10; i++) {
        const mid = (a + b) / 2;
        e[c] = Math.exp(mid);
        const m = mine(read(e));
        if ((m[0] + m[1]) / 2 > 0) b = mid;
        else a = mid;
      }
      value = Math.exp((a + b) / 2);
    }
    result.push(value);
  }
  return result;
}

/** Every combination of the grid's axes, the first axis outermost, as settings. */
const settings = (grid) =>
  Object.entries(grid).reduce(
    (all, [axis, values]) => all.flatMap((spec) => values.map((v) => ({ ...spec, [axis]: v }))),
    [{}],
  );

const mine = settings(GRIDS[gridName]).filter((_, index) => index % shards === shard);
for (const spec of mine) {
  if (mode === 'fit') {
    const [left, right] = fitNode(spec.tone, spec.size, spec.decay);
    console.log(JSON.stringify({ ...spec, left: +left.toFixed(2), right: +right.toFixed(2) }));
  } else {
    const dbs = levels(spec);
    console.log(JSON.stringify({ ...spec, dbs: dbs.map((d) => +d.toFixed(3)) }));
  }
}
