/* global process, structuredClone */
/**
 * The per-sample cost of a Noise operator's colour (windsor#362) in the
 * engine's FM bundle, under Node: the bundle before windsor#362, the bundle
 * with it and the fields absent, and with the lowpass, the highpass and both
 * set; and, for comparison, windsor#361's two-pole prototype. Research only.
 *
 *   node bench.mjs <repo> <before root> [<prototype root>] [--rounds 60] [--seconds 10] [--off 1]
 *
 * A root is a folder holding `scripts/sound-match/render.mjs` and the FM
 * bundle it renders, `packages/engine/src/worklet/generated/fm-processor.js`:
 * `<repo>` is this branch; `<before root>` holds `origin/main`'s two files
 * from before the change (`git show origin/main:<path>`); `<prototype root>`
 * is a mirror `../2026-10-01-tom-noise-colour-prototype/build.py --poles 2`
 * wrote. Each root's `render.mjs` is imported, so each variant renders
 * through its own bundle. One note, no gate, `--seconds` long; the time is
 * wall time around `renderNote`, reported as nanoseconds per output sample of
 * the one voice. The method is the prototype's `bench.mjs`.
 *
 * Two scenarios, as the prototype's. `noise`: a lone Noise carrier held at
 * full level (the other three operators silent, so the kernel skips them,
 * the voice filter off). `tom`: `tr909-tom-mid` with every envelope held at
 * its peak, so the four-operator voice (algorithm 6, its Noise modulator on
 * D) never sleeps. Filters at 6 kHz lowpass and 2 kHz highpass. For a scale,
 * the tom also runs on the before bundle with its voice filter at 24 dB/oct,
 * so the difference is one two-pole `Svf` section.
 *
 * `--off 1` measures the off path alone: the before bundle, the before
 * bundle again (the run's own noise floor) and this branch with the fields
 * absent, so the rotation is three variants long rather than eight.
 *
 * Rounds interleave the variants, rotating their order, after two warm-up
 * rounds. Reported: the median ns per sample over rounds, and the median of
 * the per-round difference against the before bundle measured in the same
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
  const options = { rounds: 60, seconds: 10, off: 0 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = Number(argv[++i]);
    else positional.push(argv[i]);
  }
  if (positional.length < 2 || positional.length > 3) {
    process.stderr.write('usage: node bench.mjs <repo> <before root> [<prototype root>]\n');
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
  noise.ops = noise.ops.map((op, i) =>
    i === 2 ? { ...op, wave: NOISE_WAVE, level: 1 } : { ...op, ...SILENT },
  );
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

/** The off path alone (`--off 1`): before, before again, and this branch with the fields absent. */
function offPath(patch, render) {
  return [
    { name: 'before', render: render.before, patch },
    { name: 'before, again', render: render.before, patch },
    { name: 'engine, absent', render: render.engine, patch },
  ];
}

function variants(scenario, render, off) {
  const { patch, op } = scenario;
  if (off) return offPath(patch, render);
  const both = coloured(patch, op, { noiseLp: LP_HZ, noiseHp: HP_HZ });
  const list = [{ name: 'before', render: render.before, patch }];
  if (scenario.name === 'tom') {
    const slope24 = { ...patch, filter: { ...patch.filter, slope24: true } };
    list.push({ name: 'before, svf x2', render: render.before, patch: slope24 });
  }
  list.push(
    { name: 'engine, absent', render: render.engine, patch },
    { name: 'engine, lp', render: render.engine, patch: coloured(patch, op, { noiseLp: LP_HZ }) },
    { name: 'engine, hp', render: render.engine, patch: coloured(patch, op, { noiseHp: HP_HZ }) },
    { name: 'engine, lp+hp', render: render.engine, patch: both },
  );
  if (render.prototype) {
    list.push(
      { name: 'prototype, absent', render: render.prototype, patch },
      { name: 'prototype, lp+hp', render: render.prototype, patch: both },
    );
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
    engine: await renderer(roots[0]),
    before: await renderer(roots[1]),
    prototype: roots[2] ? await renderer(roots[2]) : null,
  };
  process.stdout.write(
    `node ${process.version}, ${options.rounds} rounds of ${options.seconds} s per variant\n`,
  );
  for (const scenario of scenarios(roots[0])) {
    process.stdout.write(`\n${scenario.name}: ns/sample, and against before (median [IQR])\n`);
    for (const r of bench(variants(scenario, render, options.off), options)) {
      const sign = r.delta >= 0 ? '+' : '';
      const d = `${sign}${r.delta.toFixed(2)} [${r.q1.toFixed(2)}, ${r.q3.toFixed(2)}]`;
      process.stdout.write(`  ${r.name.padEnd(18)} ${r.ns.toFixed(2).padStart(7)}  ${d}\n`);
    }
  }
}

await main();
