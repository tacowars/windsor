/* global console, process */
/**
 * The Acid Ladder against Roland's TB-303 software instrument (windsor#574,
 * decision 6). For every recording, note and Cut Off section it reads a
 * window inside the held note (0.5 s to 1.8 s after the onset) and reports
 * the levels of harmonics 1–16 in dB against the same waveform's 0 %
 * resonance, lowest-cutoff, note 33 fundamental, the resonance's emphasis
 * (the three neighbouring harmonics that rose most against 0 % resonance:
 * their frequency and lift) and the spectral centroid. It maps each Cut Off
 * percentage to the Windsor cutoff whose emphasis at the top of the Reso knob
 * falls where the ACB's at 100 % does, renders Windsor's `acid-saw` and
 * `acid-square` reduced to the recipe at the same notes, cutoffs and Reso
 * travel (0, 50, 90 and 100 %: reso 0.5, 2.45, 8.74 and 12 on the knob's log
 * sweep), measures them the same way, and prints the two side by side, then
 * three summaries: the emphasis, the bass loss and the error per resonance.
 *
 *   node compare.mjs <303-filter folder> [--set NAME=value]... [--level 1] [--cells]
 *
 * The folder is the one `settings.txt` describes; each WAV is checked
 * against its SHA-256 there, read in place and never copied. `--set`
 * overrides one of the three tunables (`LADDER_FEEDBACK_MAX`,
 * `LADDER_FEEDBACK_HP_HZ`, `LADDER_INPUT_SCALE`) in a copy of the bundle's
 * text; `--level` is the carrier's peak into the ladder (the patch's volume,
 * with drive off); `--cells` prints the full side-by-side table. The
 * recordings are the whole Roland voice: behavioural references, never
 * filter measurements and never goldens.
 */
import { NOTES, SECTIONS, WINDOW, measureAcb, noteHz } from './acbNotes.mjs';
import { annotate, bassTable, cellTable, emphasisTable, errorTable, EMPHASIS_FLOOR_DB } from './compareReport.mjs';
import { emphasis } from './spectrum.mjs';
import { fitCutoff, measureWindsor, noteRenderer, referencePatch } from './windsorNotes.mjs';

/** The highest harmonic frequency read: under the 48 kHz Nyquist with room for the window's skirt. */
const MAX_HZ = 15000;
/** The note the Cut Off map is fitted on (55 Hz: the finest harmonic spacing). */
const MAP_NOTE = 33;
const MAP_NOTE_INDEX = NOTES.indexOf(MAP_NOTE);
/** Each section's emphasis is searched within this factor of its map target, either way. */
const BAND_SPAN = 2;

function parseArgs(argv) {
  const overrides = {};
  const rest = [];
  let level = 1;
  let cells = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--set') {
      const [name, value] = argv[++i].split('=');
      overrides[name] = Number(value);
    } else if (argv[i] === '--level') level = Number(argv[++i]);
    else if (argv[i] === '--cells') cells = true;
    else rest.push(argv[i]);
  }
  if (rest.length !== 1) {
    console.error('usage: node compare.mjs <303-filter folder> [--set NAME=value]... [--level 1] [--cells]');
    process.exit(2);
  }
  return { folder: rest[0], overrides, level, cells };
}

/** The ACB's emphasis at 100 % on the map note, anywhere, geometric mean of the two waves, per section. */
function mapTargets(raw) {
  return SECTIONS.map((_, s) => {
    const hz = raw.map((byRes) => {
      const top = byRes[3][s][MAP_NOTE_INDEX];
      return emphasis(top.levels, byRes[0][s][MAP_NOTE_INDEX].levels, top.f0, EMPHASIS_FLOOR_DB).hz;
    });
    return Math.sqrt(hz[0] * hz[1]);
  });
}

function main() {
  const { folder, overrides, level, cells } = parseArgs(process.argv.slice(2));
  const raw = measureAcb(folder, MAX_HZ);
  const targets = mapTargets(raw);
  const bands = targets.map((hz) => [hz / BAND_SPAN, hz * BAND_SPAN]);
  const acb = annotate(raw, bands);
  const render = noteRenderer(overrides);
  const window = { ...WINDOW, maxHz: MAX_HZ };
  const patches = ['acid-saw', 'acid-square'].map((id) => referencePatch(id, level));
  const fits = targets.map((targetHz, s) =>
    fitCutoff(render, patches[0], { note: MAP_NOTE, targetHz, window, floorDb: EMPHASIS_FLOOR_DB, band: bands[s] }),
  );
  const cutoffs = fits.map((f) => f.cutoff);
  const win = annotate(
    patches.map((patch) => measureWindsor(render, patch, { cutoffs, notes: NOTES, window })),
    bands,
  );

  console.log(`overrides: ${JSON.stringify(overrides)}  level into the ladder: ${level}`);
  console.log(`window ${WINDOW.from}–${WINDOW.to} s after each onset; note ${MAP_NOTE} is ${noteHz(MAP_NOTE).toFixed(2)} Hz nominal\n`);
  console.log('Cut Off map (the ACB emphasis at 100 % on note 33, saw and square; Windsor fitted on the saw at reso 12)');
  SECTIONS.forEach((section, s) => {
    console.log(
      `  ${section.toFixed(2).padStart(6)}%  ACB emphasis ${targets[s].toFixed(0).padStart(5)} Hz  ->  Windsor cutoff ${cutoffs[s].toFixed(1).padStart(7)} Hz (emphasis ${fits[s].emphasisHz.toFixed(0)} Hz)`,
    );
  });
  if (cells) console.log(`\n${cellTable(acb, win, cutoffs)}`);
  console.log(`\nEmphasis (mean over notes 33, 45, 57)\n${emphasisTable(acb, win)}`);
  console.log(`\nBass: each note's fundamental against its own 0 % resonance, dB\n${bassTable(acb, win)}`);
  console.log(`\nErrors, Windsor minus ACB, over the harmonics both hold above the floor\n${errorTable(acb, win)}`);
}

main();
