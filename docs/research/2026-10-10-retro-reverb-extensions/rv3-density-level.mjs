/* global URL, process, console */
// RV-3 fix round 2: Density's loudness match, measured. Offline in Node on a shipped bundle.
//
//   node rv3-density-level.mjs fit [bundle.js]           the table's nodes (prints the arrays)
//   node rv3-density-level.mjs check [bundle.js] [grid]  Density 1 against 0, in dB, per setting
//
// Probes: an impulse, whose response energy is exactly the expected energy for a white input,
// and three 100 ms white-noise bursts (seeded), pooled by summing their energies, which estimates
// the same expectation. Mix 1, Character 0, 3 to 6 s per render. For each probe and channel,
// `fit` separates the ends' and the taps' energies from two renders (Density 0 and 1) and the
// tank's own gains (`endLeft`, `tapGainsLeft`, ...): Density 0 plays trim × S, Density 1 plays
// c × (S + Σ w t), so E = Σ w² × |S|² / |Σ w t|², the end sum's energy in taps, holds for any
// normalisation the bundle used.
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const [mode = 'check', bundleArg, gridName = 'nodes'] = process.argv.slice(2);
const bundle =
  bundleArg ?? new URL('packages/engine/src/worklet/generated/retro-reverb-processor.js', root);
const source = readFileSync(bundle, 'utf8');
let Processor;
class Base {
  port = { onmessage: null, postMessage() {} };
}
const C = new Function(
  'AudioWorkletProcessor',
  'sampleRate',
  'registerProcessor',
  `${source}\nreturn RETRO_REVERB_DSP;`,
)(Base, 48000, (_name, ctor) => {
  Processor = ctor;
});

const RATE = 48000;
// c97b098's constants, which a node keeps unless they miss by more than BAND dB.
const PREVIOUS = [5.2, 3.3];
const BAND = 0.7;
const NODES = {
  tone: [800, 1500, 2500, 4200, 9000],
  size: [0.25, 0.5, 1, 3, 10],
  decay: [0.2, 0.5, 1.4, 2, 6, 20],
  diffusion: [0.7],
};
const GRIDS = {
  nodes: NODES,
  between: { tone: [1100, 3200, 6000], size: [0.35, 0.7, 2, 6], decay: [0.3, 1, 4, 12], diffusion: [0.7] },
  audition: { tone: [4200], size: [0.5, 1, 3], decay: [1.4, 2], diffusion: [0.7] },
  diffusion: { tone: [800, 9000], size: [0.25, 10], decay: [0.2, 20], diffusion: [0, 1] },
};

function noise(seed) {
  let s = seed >>> 0;
  return Float32Array.from({ length: RATE * 0.1 }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296 - 0.5) * 0.8;
  });
}
const PROBES = { impulse: Float32Array.of(0.8), b1: noise(12345), b2: noise(777), b3: noise(4242) };

/** Each channel's energy, and the tank's end gains and Σ (tap gain / end gain)² at the end. */
function render(spec, probe, seconds) {
  const params = Object.fromEntries(
    Processor.parameterDescriptors.map((d) => [d.name, new Float32Array([d.defaultValue])]),
  );
  for (const [k, v] of Object.entries({ mix: 1, character: 0, ...spec }))
    params[k] = new Float32Array([v]);
  const node = new Processor({
    parameterData: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v[0]])),
  });
  const input = [new Float32Array(128), new Float32Array(128)];
  const output = [new Float32Array(128), new Float32Array(128)];
  const energy = [0, 0];
  for (let frame = 0; frame < RATE * seconds; frame += 128) {
    for (let i = 0; i < 128; i++) input[0][i] = input[1][i] = probe[frame + i] ?? 0;
    node.process([input], [output], params);
    for (let c = 0; c < 2; c++) for (const v of output[c]) energy[c] += v * v;
  }
  const tank = node.dsp.tank;
  const taps = (gains, end) => gains.reduce((s, g) => s + (g / end) ** 2, 0);
  return {
    energy,
    end: [tank.endLeft, tank.endRight],
    taps: [taps(tank.tapGainsLeft, tank.endLeft), taps(tank.tapGainsRight, tank.endRight)],
  };
}

/** Per probe (impulse, pooled bursts): Density 1 over 0 in dB, and the end sum's energy in taps. */
function measure(spec) {
  const seconds = Math.min(6, 3 + spec.decay / 2);
  const result = {};
  for (const [name, probe] of Object.entries(PROBES)) {
    const d0 = render({ ...spec, density: 0 }, probe, seconds);
    const d1 = render({ ...spec, density: 1 }, probe, seconds);
    if (name === 'impulse') result.impulse = { d0, d1 };
    else if (!result.bursts) result.bursts = { d0, d1 };
    else
      for (let c = 0; c < 2; c++) {
        result.bursts.d0.energy[c] += d0.energy[c];
        result.bursts.d1.energy[c] += d1.energy[c];
      }
  }
  return Object.fromEntries(
    Object.entries(result).map(([name, { d0, d1 }]) => [
      name,
      [0, 1].map((c) => {
        const s = d0.energy[c] / C.outputTrim ** 2;
        const t = d1.energy[c] / d1.end[c] ** 2 - s;
        return { db: 10 * Math.log10(d1.energy[c] / d0.energy[c]), taps: d1.taps[c], e: (d1.taps[c] * s) / t };
      }),
    ]),
  );
}

/** The E nearest PREVIOUS (in ratio) that keeps every probe within BAND dB; else the middle. */
function node(probes, c) {
  let low = 0,
    high = Infinity;
  for (const { taps, e } of probes.map((p) => p[c])) {
    const q = 1 + taps / e;
    low = Math.max(low, taps / (q * 10 ** (BAND / 10) - 1));
    const under = q * 10 ** (-BAND / 10) - 1;
    if (under > 0) high = Math.min(high, taps / under);
  }
  return low <= high ? Math.min(Math.max(PREVIOUS[c], low), high) : Math.sqrt(low * high);
}

const grid = GRIDS[mode === 'fit' ? 'nodes' : gridName];
const rows = [];
for (const diffusion of grid.diffusion)
  for (const tone of grid.tone)
    for (const size of grid.size)
      for (const decay of grid.decay) {
        const spec = { tone, size, decay, diffusion };
        rows.push({ spec, ...measure(spec) });
      }
if (mode === 'fit') {
  for (const [c, name] of [
    [0, 'left'],
    [1, 'right'],
  ]) {
    console.log(`  ${name}: [`);
    for (const tone of grid.tone) {
      console.log(`    // Tone ${tone}`);
      console.log('    [');
      for (const size of grid.size) {
        const row = grid.decay.map((decay) => {
          const r = rows.find((q) => q.spec.tone === tone && q.spec.size === size && q.spec.decay === decay);
          return node([r.impulse, r.bursts], c).toFixed(2);
        });
        console.log(`      [${row.join(', ')}],`);
      }
      console.log('    ],');
    }
    console.log('  ],');
  }
} else {
  let worst = 0;
  for (const r of rows) {
    const dbs = [...r.impulse, ...r.bursts].map((x) => x.db);
    worst = Math.max(worst, ...dbs.map(Math.abs));
    const s = r.spec;
    console.log(
      `tone ${s.tone} size ${s.size} decay ${s.decay} diffusion ${s.diffusion}: impulse ${dbs[0].toFixed(2)} / ${dbs[1].toFixed(2)}, bursts ${dbs[2].toFixed(2)} / ${dbs[3].toFixed(2)}`,
    );
  }
  console.log(`worst ${worst.toFixed(2)} dB`);
}
