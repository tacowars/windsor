/* global process, console */
/**
 * Decision 2's framed metric (windsor#652) on `lead-sync-sweep`: one held
 * note at MIDI 72 and one at 84, 8 s each (two cycles of its 0.25 Hz LFO),
 * left channel at 48 kHz, through each variant; the frames' median and p90
 * alias under the signal, in dB. Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-study/framed.mjs [--variants shipped,A,...]
 *     [--patch <id>] [--notes 72,84]
 *
 * `--patch` takes a file of this folder's `fallbackPatches.mjs` by name
 * (`pm05`, `pm1`, `fb`, `w025`, `tone03`) or a library id.
 */
import { FALLBACKS } from './fallbackPatches.mjs';
import { library, noteHz, renderNote, variant } from './render.mjs';
import { framed } from './spectrum.mjs';

const DEFAULT = 'shipped,shipped+D,ref16,ref16s,A,A+D,C,C+D,B2,B2+D,B4,B4+D,AB2,AB2+D';
const SECONDS = 8;

function parseArgs(argv) {
  const options = { variants: DEFAULT, patch: 'lead-sync-sweep', notes: '72,84', repo: '.' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) options[argv[i].slice(2)] = argv[++i];
  }
  return options;
}

const args = parseArgs(process.argv.slice(2));
const base = library(args.repo, 'lead-sync-sweep');
const patch = FALLBACKS[args.patch]
  ? FALLBACKS[args.patch].sweep(base)
  : library(args.repo, args.patch);
const notes = args.notes.split(',').map(Number);
console.log(
  `${args.patch}: framed alias under signal in dB, median / p90 (8192, hop 2048, 0.5–8 s)`,
);
console.log(`| Variant | ${notes.map((n) => `MIDI ${n} median | MIDI ${n} p90`).join(' | ')} |`);
console.log(`|---|${notes.map(() => '---|---').join('|')}|`);
for (const name of args.variants.split(',')) {
  const v = variant(args.repo, name);
  const cells = notes.map((note) => {
    const { median, p90 } = framed(renderNote(v, patch, note, SECONDS), noteHz(note));
    return `${median.toFixed(1)} | ${p90.toFixed(1)}`;
  });
  console.log(`| ${name} | ${cells.join(' | ')} |`);
}
