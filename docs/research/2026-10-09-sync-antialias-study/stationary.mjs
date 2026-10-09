/* global process, console */
/**
 * `alias.mjs`'s stationary figures (windsor#652, decision 2) for every
 * variant: one synced carrier at ratio 3.7, held, the Saw, the Square and a
 * 0.3 Pulse at MIDI 60 to 96; alias under the signal in dB over one frame of
 * 32 768 from 0.1 s. Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-study/stationary.mjs [--variants shipped,A,...]
 *     [--notes 60,72,84,96] [--ratio 3.7] [--cases saw,square,pulse | pm05,pm1,fb,w025,tone03]
 *     [--sync note | off]
 *
 * `--sync off` turns the carrier's sync off, which at a whole ratio leaves
 * it periodic at the note: what a case aliases without sync.
 *
 * A held carrier's ratio is not modulated, so candidate D cannot change it:
 * `--check-d` renders each `+D` variant too and reports whether it is
 * bit-identical. The 16× reference here decimates through `REF16`, not
 * `alias.mjs`'s 2 049-tap Blackman.
 */
import { FALLBACKS, syncedCarrier } from './fallbackPatches.mjs';
import { noteHz, renderNote, variant } from './render.mjs';
import { stationary } from './spectrum.mjs';

const WAVES = { saw: 1, square: 2, pulse: 10 };
const PULSE_DUTY = 0.3;
const SECONDS = (4800 + 32768) / 48000;

function parseArgs(argv) {
  const options = {
    variants: 'shipped,ref16,A,C,B2,B4,AB2',
    notes: '60,72,84,96',
    ratio: '3.7',
    cases: 'saw,square,pulse',
    sync: 'note',
    repo: '.',
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check-d') options.checkD = true;
    else if (argv[i].startsWith('--')) options[argv[i].slice(2)] = argv[++i];
  }
  return options;
}

/** The held carrier a case names: a wave, or one of decision 5's synced Saws. */
function patchFor(name, ratio, sync) {
  const patch = FALLBACKS[name]
    ? FALLBACKS[name].carrier(WAVES.saw, ratio)
    : syncedCarrier(WAVES[name], ratio, name === 'pulse' ? PULSE_DUTY : 1);
  patch.ops[0].sync = sync;
  return patch;
}

const args = parseArgs(process.argv.slice(2));
const ratio = Number(args.ratio);
const names = args.variants.split(',');
const variants = names.map((n) => variant(args.repo, n));
const withD = args.checkD ? names.map((n) => variant(args.repo, `${n}+D`)) : [];
console.log(`ratio ${ratio}, sync ${args.sync}, 48 kHz; stationary alias under signal in dB`);
console.log(`| Case | Note | ${names.join(' | ')} |`);
console.log(`|---|---|${names.map(() => '---').join('|')}|`);
let identical = true;
for (const note of args.notes.split(',').map(Number)) {
  for (const name of args.cases.split(',')) {
    const patch = patchFor(name, ratio, args.sync);
    const cells = variants.map((v, j) => {
      const x = renderNote(v, patch, note, SECONDS);
      if (args.checkD) {
        const y = renderNote(withD[j], patch, note, SECONDS);
        identical &&= x.every((s, k) => Object.is(s, y[k]));
      }
      return stationary(x, noteHz(note)).toFixed(1);
    });
    console.log(`| ${name} | ${note} | ${cells.join(' | ')} |`);
  }
}
if (args.checkD) console.log(`every +D render bit-identical to its variant: ${identical}`);
