/* global process, structuredClone */
/**
 * What the Acid Ladder mode costs (windsor#573, decision 9 and the
 * acceptance): eight held voices of one patch through the FM bundle under
 * Node, the voice filter Off, Lowpass and Bandpass at 12 dB, Lowpass at
 * 24 dB, Formant, and Acid on each solver candidate (1× with four Newton
 * steps, the shipped one; 2× with three), on this branch's bundle and, for
 * the old modes, the bundle before the change. Research only. The Formant
 * bench's scenario and method (`../2026-10-02-formant-filter/bench.mjs`):
 * `pad-drift` with `spread` 0, every sustain raised so dormancy never
 * engages, the variants interleaved in rounds with their order rotated, two
 * warm-up rounds. The candidate is set on each voice's ladder before the
 * notes, so both run in the one bundle.
 *
 *   node bench.mjs <repo> <before root> [--rounds 40] [--seconds 5] [--acid 0]
 *
 * `<before root>` holds `origin/main`'s FM bundle from before the change at
 * `packages/engine/src/worklet/generated/fm-processor.js` (`git show`).
 * `--acid 0` leaves the Acid variants out, so the old modes can be read
 * with and without an Acid voice in the run. Reported: the median ns per
 * voice per output sample over the rounds, and each variant's median
 * per-round difference from the same bundle's Off (the filter's own cost),
 * with its interquartile range.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { CANDIDATES, SR, loadBundle } from './bundle.mjs';

const BLOCK = 128;
const WARMUP_ROUNDS = 2;
const NOTES = [43, 48, 52, 55, 59, 62, 64, 67];
const MODES = { off: 0, lp12: 1, bp12: 3, lp24: 1, formant: 5, 'acid 1x4': 6, 'acid 2x3': 6 };

function parseArgs(argv) {
  const options = { rounds: 40, seconds: 5, acid: 1 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = Number(argv[++i]);
    else positional.push(argv[i]);
  }
  if (positional.length !== 2) {
    process.stderr.write(
      'usage: node bench.mjs <repo> <before root> [--rounds n] [--seconds s] [--acid 0]\n',
    );
    process.exit(2);
  }
  return { options, roots: positional };
}

/** `pad-drift`, one voice a note, every operator held at its sustain. */
function basePatch(repo) {
  const file = join(repo, 'packages', 'engine', 'src', 'patches', 'pad-drift.json');
  const patch = { ...JSON.parse(readFileSync(file, 'utf8')).patch, spread: 0 };
  for (const op of patch.ops) op.env.sustainLevel = Math.max(op.env.sustainLevel, 0.6);
  return patch;
}

function withMode(patch, name) {
  const out = structuredClone(patch);
  out.filter = { ...out.filter, mode: MODES[name], slope24: name === 'lp24', vowel: 1.5 };
  // The Acid variants near the top of the Reso, where the ladder works hardest.
  if (name.startsWith('acid')) out.filter.resonance = 9;
  return out;
}

/** Wall time of `seconds` of eight held voices, in ns per voice per output sample. */
function timeOne({ bundle, patch, solver }, seconds) {
  const processor = new bundle.Processor({
    processorOptions: { maxVoices: NOTES.length, patch: structuredClone(patch), seed: 1 },
  });
  if (solver) {
    for (const voice of processor.voices) {
      voice.ladder.oversample = solver.oversample;
      voice.ladder.steps = solver.steps;
    }
  }
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  bundle.setFrame(0);
  NOTES.forEach((note, i) =>
    processor.port.onmessage({ data: { type: 'noteOn', id: i + 1, note, velocity: 0.9, frame: 0 } }),
  );
  const blocks = Math.round((seconds * SR) / BLOCK);
  const started = performance.now();
  for (let b = 0; b < blocks; b++) {
    bundle.setFrame(b * BLOCK);
    processor.process([], [[left, right]], params);
  }
  const elapsed = performance.now() - started;
  const held = processor.voices.filter((v) => v.active && !v.dormant).length;
  if (held !== NOTES.length) throw new Error(`expected ${NOTES.length} sounding voices, got ${held}`);
  return (elapsed * 1e6) / (blocks * BLOCK * NOTES.length);
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.ceil(at)] - s[lo]) * (at - lo);
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
      delta[i].push(t - times[list[i].offIndex]);
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

function variants(repo, before, { acid }) {
  const patch = basePatch(repo);
  const engine = loadBundle(repo);
  const old = loadBundle(before);
  const oldModes = ['off', 'lp12', 'bp12', 'lp24', 'formant'];
  const engineModes = [...oldModes, ...(acid ? ['acid 1x4', 'acid 2x3'] : [])];
  const list = [];
  for (const [label, bundle, names] of [
    ['before', old, oldModes],
    ['engine', engine, engineModes],
  ]) {
    const offIndex = list.length;
    for (const name of names) {
      const solver = name.startsWith('acid') ? CANDIDATES[name.slice(5)] : null;
      list.push({ name: `${label} ${name}`, bundle, patch: withMode(patch, name), solver, offIndex });
    }
  }
  return list;
}

function main() {
  const { options, roots } = parseArgs(process.argv.slice(2));
  const list = variants(roots[0], roots[1], options);
  process.stdout.write(
    `node ${process.version}, ${options.rounds} rounds of ${options.seconds} s per variant, ${NOTES.length} voices\n`,
  );
  process.stdout.write('ns per voice-sample, and against its bundle Off (median [IQR])\n');
  const results = bench(list, options);
  for (const r of results) {
    const sign = r.delta >= 0 ? '+' : '';
    const d = `${sign}${r.delta.toFixed(2)} [${r.q1.toFixed(2)}, ${r.q3.toFixed(2)}]`;
    process.stdout.write(`  ${r.name.padEnd(20)} ${r.ns.toFixed(2).padStart(7)}  ${d}\n`);
  }
  const by = (name) => results.find((r) => r.name === name);
  const lp24 = by('engine lp24');
  for (const name of ['engine acid 1x4', 'engine acid 2x3']) {
    const r = by(name);
    if (!r) continue;
    process.stdout.write(
      `\n${name} / engine lp24: total ${(r.ns / lp24.ns).toFixed(2)}x, filter alone ${(r.delta / lp24.delta).toFixed(2)}x`,
    );
  }
  process.stdout.write('\n');
}

main();
