/* global process, structuredClone */
/**
 * The per-sample cost of a Noise operator's own colour filters (windsor#361),
 * in the bundle, under Node. Research only.
 *
 *   node bench.mjs <repo> <one-pole mirror> <two-pole mirror> [--rounds 60] [--seconds 10]
 *
 * Each root's `scripts/sound-match/render.mjs` is imported, so each variant
 * renders through its own bundle exactly as the fits do: the repository's is
 * the shipped bundle, the mirrors are what `build.py --poles 1|2` wrote. One
 * note, no gate, `--seconds` long; the time is wall time around `renderNote`
 * and the result is nanoseconds per output sample of the one voice.
 *
 * Two scenarios. `noise`: a lone Noise carrier held at full level (the other
 * three operators silent, so the voice skips them, and the voice filter
 * off), which isolates the operator. `tom`: `tr909-tom-mid` with every envelope held at its peak, so
 * the four-operator voice (algorithm 6, its Noise modulator on D) never
 * sleeps. Variants: the shipped bundle; each mirror with the fields absent;
 * and each mirror with the lowpass, the highpass, and both set. For a scale,
 * the tom also runs on the shipped bundle with its voice filter (one
 * two-pole `Svf` section, on in the patch) off, and at 24 dB/oct (two).
 *
 * Rounds interleave the variants, rotating their order, after two warm-up
 * rounds. Reported: the median ns per sample over rounds, and the median of
 * the per-round difference against the shipped bundle measured in the same
 * round, with its interquartile range.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const SR = 48000;
const WARMUP_ROUNDS = 2;
const NOISE_WAVE = 4;
const FILTER_OFF = 0;
const SILENT = { level: 0 };
const LP_HZ = 6000;
const HP_HZ = 2000;
const TOM_NOISE_OP = 3;

function parseArgs(argv) {
  const options = { rounds: 60, seconds: 10 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = Number(argv[++i]);
    else positional.push(argv[i]);
  }
  if (positional.length !== 3) {
    process.stderr.write('usage: node bench.mjs <repo> <one-pole mirror> <two-pole mirror>\n');
    process.exit(2);
  }
  return { options, roots: positional };
}

async function renderer(root) {
  const url = pathToFileURL(join(root, 'scripts', 'sound-match', 'render.mjs'));
  return (await import(url.href)).renderNote;
}

function scenarios(repo) {
  const tom = JSON.parse(
    readFileSync(join(repo, 'packages', 'engine', 'src', 'patches', 'tr909-tom-mid.json'), 'utf8'),
  ).patch;
  const noise = structuredClone(tom);
  noise.algorithm = 7;
  noise.ops = noise.ops.map((op, i) => (i === 2 ? { ...op, wave: NOISE_WAVE, level: 1 } : { ...op, ...SILENT }));
  noise.filter = { ...noise.filter, mode: FILTER_OFF };
  for (const patch of [tom, noise]) {
    for (const op of patch.ops) op.env = { ...op.env, attackTime: 0, sustainLevel: 1 };
  }
  return [
    { name: 'noise', patch: noise, op: 2 },
    { name: 'tom', patch: tom, op: TOM_NOISE_OP },
  ];
}

function coloured(patch, op, fields) {
  const out = structuredClone(patch);
  Object.assign(out.ops[op], fields);
  return out;
}

/** The tom's voice filter (a two-pole lowpass, on in the shipped patch) off, and doubled to 24 dB/oct. */
function voiceFilter(patch) {
  return [
    { name: 'svf off', patch: { ...patch, filter: { ...patch.filter, mode: FILTER_OFF } } },
    { name: 'svf x2', patch: { ...patch, filter: { ...patch.filter, slope24: true } } },
  ];
}

function variants(scenario, render) {
  const { patch, op } = scenario;
  const list = [{ name: 'shipped', render: render.shipped, patch }];
  if (scenario.name === 'tom') {
    for (const v of voiceFilter(patch)) list.push({ ...v, render: render.shipped });
  }
  for (const poles of ['1p', '2p']) {
    list.push({ name: `${poles} off`, render: render[poles], patch });
    list.push({ name: `${poles} lp`, render: render[poles], patch: coloured(patch, op, { noiseLp: LP_HZ }) });
    list.push({ name: `${poles} hp`, render: render[poles], patch: coloured(patch, op, { noiseHp: HP_HZ }) });
    list.push({
      name: `${poles} lp+hp`,
      render: render[poles],
      patch: coloured(patch, op, { noiseLp: LP_HZ, noiseHp: HP_HZ }),
    });
  }
  return list;
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.ceil(at)] - s[lo]) * (at - lo);
}

function timeOne(variant, seconds) {
  const started = performance.now();
  variant.render(variant.patch, { seconds, seed: 1 });
  return ((performance.now() - started) * 1e6) / (seconds * SR);
}

function bench(list, { rounds, seconds }) {
  const ns = list.map(() => []);
  const delta = list.map(() => []);
  for (let round = 0; round < rounds + WARMUP_ROUNDS; round++) {
    const times = new Array(list.length);
    for (let k = 0; k < list.length; k++) {
      const i = (k + round) % list.length;
      times[i] = timeOne(list[i], seconds);
    }
    if (round < WARMUP_ROUNDS) continue;
    times.forEach((t, i) => {
      ns[i].push(t);
      delta[i].push(t - times[0]);
    });
  }
  return list.map((v, i) => ({
    name: v.name,
    ns: quantile(ns[i], 0.5),
    delta: quantile(delta[i], 0.5),
    q1: quantile(delta[i], 0.25),
    q3: quantile(delta[i], 0.75),
  }));
}

async function main() {
  const { options, roots } = parseArgs(process.argv.slice(2));
  const render = {
    shipped: await renderer(roots[0]),
    '1p': await renderer(roots[1]),
    '2p': await renderer(roots[2]),
  };
  process.stdout.write(
    `node ${process.version}, ${options.rounds} rounds of ${options.seconds} s per variant\n`,
  );
  for (const scenario of scenarios(roots[0])) {
    process.stdout.write(`\n${scenario.name}: ns/sample, and against shipped (median [IQR])\n`);
    for (const r of bench(variants(scenario, render), options)) {
      const d = `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2)} [${r.q1.toFixed(2)}, ${r.q3.toFixed(2)}]`;
      process.stdout.write(`  ${r.name.padEnd(10)} ${r.ns.toFixed(2).padStart(7)}  ${d}\n`);
    }
  }
}

await main();
