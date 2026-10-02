/* global process */
/**
 * The Formant filter's makeup gain (windsor#331, decision 3): white noise
 * through the vowel "a" at the default resonance (0.707, so Q 5.66) against
 * white noise through the Bandpass mode at the same resonance and a 1 kHz
 * cutoff, both through the shipped FM bundle under Node. The RMS ratio,
 * times the `FORMANT_MAKEUP` the bundle was built with, is the makeup that
 * puts the two at one RMS. Research only.
 *
 *   node makeup.mjs <repo> [--seconds 20] [--seeds 4] [--cutoff 1000]
 *
 * One note of a lone Noise carrier (operator A, the others silent, every
 * envelope held at 1, attack 0), rendered through `<repo>`'s
 * `scripts/sound-match/render.mjs`, the first 0.1 s skipped. Each seed is a
 * different noise; the ratio is reported per seed and pooled.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SR = 48000;
const NOISE_WAVE = 4;
const SKIP_SECONDS = 0.1;
const BP = 3;
const FORMANT = 5;
const REFERENCE_CUTOFF_HZ = 1000;
const DEFAULT_RESONANCE = 0.707;

function parseArgs(argv) {
  const options = { seconds: 20, seeds: 4, cutoff: REFERENCE_CUTOFF_HZ };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = Number(argv[++i]);
    else positional.push(argv[i]);
  }
  if (positional.length !== 1) {
    process.stderr.write('usage: node makeup.mjs <repo> [--seconds 20] [--seeds 4] [--cutoff 1000]\n');
    process.exit(2);
  }
  return { options, repo: positional[0] };
}

const held = { attackTime: 0, decayTime: 0.01, sustainLevel: 1, peakLevel: 1 };

/** A lone held Noise carrier through `filter`. */
function noisePatch(filter) {
  return {
    algorithm: 0,
    volume: 0.5,
    ops: [
      { wave: NOISE_WAVE, level: 1, velSens: 0, env: held },
      { level: 0 },
      { level: 0 },
      { level: 0 },
    ],
    filter: { resonance: DEFAULT_RESONANCE, env: held, ...filter },
  };
}

function rms(samples) {
  const from = Math.round(SKIP_SECONDS * SR);
  let sum = 0;
  for (let i = from; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length - from));
}

const builtMakeup = (repo) => {
  const source = readFileSync(
    join(repo, 'packages', 'engine', 'src', 'worklet', 'fm', 'fmConstants.ts'),
    'utf8',
  );
  return Number(/const FORMANT_MAKEUP = ([\d.e-]+);/.exec(source)[1]);
};

async function main() {
  const { options, repo } = parseArgs(process.argv.slice(2));
  const url = pathToFileURL(join(repo, 'scripts', 'sound-match', 'render.mjs'));
  const { renderNote } = await import(url.href);
  const makeup = builtMakeup(repo);
  const bp = noisePatch({ mode: BP, cutoff: options.cutoff });
  const vowelA = noisePatch({ mode: FORMANT, vowel: 0 });
  process.stdout.write(
    `node ${process.version}; FORMANT_MAKEUP built as ${makeup}; ${options.seconds} s a seed\n`,
  );
  let sumBp = 0;
  let sumA = 0;
  for (let seed = 1; seed <= options.seeds; seed++) {
    const render = (patch) => renderNote(patch, { seconds: options.seconds, seed });
    const a = rms(render(vowelA));
    const b = rms(render(bp));
    sumBp += b * b;
    sumA += a * a;
    process.stdout.write(
      `seed ${seed}: BP rms ${b.toFixed(6)}, Formant a rms ${a.toFixed(6)}, makeup ${((makeup * b) / a).toFixed(4)}\n`,
    );
  }
  const pooled = (makeup * Math.sqrt(sumBp)) / Math.sqrt(sumA);
  process.stdout.write(`pooled makeup: ${pooled.toFixed(4)}\n`);
}

await main();
