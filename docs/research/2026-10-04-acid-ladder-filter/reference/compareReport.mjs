/**
 * The tables `compare.mjs` prints (windsor#574, decision 6), from the ACB's
 * and Windsor's readings, both shaped `[wave][resonance][section][note]`.
 * Every level is in dB against its own source's 0 % resonance, lowest
 * cutoff section, note 33 fundamental, so the bass loss and the fall in
 * level with resonance stay in the numbers; nothing is normalised.
 */
import { NOTES, RESONANCES, SECTIONS, WAVES } from './acbNotes.mjs';
import { emphasis } from './spectrum.mjs';

/** Harmonics in the side-by-side table. */
export const HARMONICS = 16;
/** A harmonic the ACB holds below this (dB against the reference) is left out of the errors. */
export const FLOOR_DB = -90;
/** The emphasis search ignores harmonics the 0 % resonance note holds below this (dB, absolute). */
export const EMPHASIS_FLOOR_DB = -120;

const fixed = (v, width = 6, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '—').padStart(width);
const pct = (travel) => `${Math.round(travel * 100)}%`.padStart(4);
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
const rms = (list) => Math.sqrt(mean(list.map((v) => v * v)));

/**
 * The readings with each level made relative, and each cell's emphasis
 * against 0 % resonance, searched within its section's `bands[s]` (Hz).
 */
export function annotate(data, bands) {
  return data.map((byRes) => {
    const ref = byRes[0][0][0].levels[0];
    return byRes.map((bySection, r) =>
      bySection.map((byNote, s) =>
        byNote.map((cell, n) => ({
          ...cell,
          rel: cell.levels.map((l) => l - ref),
          emphasis:
            r === 0 ? null : emphasis(cell.levels, byRes[0][s][n].levels, cell.f0, EMPHASIS_FLOOR_DB, bands[s]),
        })),
      ),
    );
  });
}

function cellLine(label, cell) {
  const harmonics = cell.rel.slice(0, HARMONICS).map((v) => fixed(v)).join('');
  const e = cell.emphasis;
  const emph = e ? `${fixed(e.hz, 6, 0)} Hz ${fixed(e.lift, 5)}` : ' '.repeat(15);
  return `  ${label} ${harmonics} | ${emph} | ${fixed(cell.centroid, 5, 0)}`;
}

/** The side-by-side table: every wave, section, note and resonance, ACB over Windsor. */
export function cellTable(acb, win, cutoffs) {
  const lines = [];
  const head = Array.from({ length: HARMONICS }, (_, h) => `H${h + 1}`.padStart(6)).join('');
  WAVES.forEach((wave, w) => {
    SECTIONS.forEach((section, s) => {
      NOTES.forEach((note, n) => {
        lines.push(
          `${wave}, Cut Off ${section}% (Windsor ${cutoffs[s].toFixed(0)} Hz), note ${note}`,
          `  res ${head} |    emphasis     | centroid`,
        );
        RESONANCES.forEach(({ travel }, r) => {
          lines.push(cellLine(`${pct(travel)} ACB`.padEnd(3), acb[w][r][s][n]));
          lines.push(cellLine(`${pct(travel)} WIN`.padEnd(3), win[w][r][s][n]));
        });
      });
    });
  });
  return lines.join('\n');
}

/** Each wave and section's emphasis at 50, 90 and 100 %: frequency and lift, mean over the notes. */
export function emphasisTable(acb, win) {
  const lines = ['wave    Cut Off   res   ACB Hz  WIN Hz   ACB dB  WIN dB'];
  WAVES.forEach((wave, w) =>
    SECTIONS.forEach((section, s) =>
      RESONANCES.slice(1).forEach(({ travel }, i) => {
        const r = i + 1;
        const pick = (data, key) => mean(data[w][r][s].map((c) => c.emphasis[key]));
        lines.push(
          `${wave.padEnd(7)} ${fixed(section, 6, 2)}%  ${pct(travel)}  ${fixed(pick(acb, 'hz'), 7, 0)} ${fixed(pick(win, 'hz'), 7, 0)}  ${fixed(pick(acb, 'lift'), 7)} ${fixed(pick(win, 'lift'), 7)}`,
        );
      }),
    ),
  );
  return lines.join('\n');
}

/** Each note's fundamental against its own 0 % resonance, at 50, 90 and 100 %: the bass loss. */
export function bassTable(acb, win) {
  const lines = ['wave    Cut Off   note   ACB 50  WIN 50   ACB 90  WIN 90  ACB 100 WIN 100'];
  WAVES.forEach((wave, w) =>
    SECTIONS.forEach((section, s) =>
      NOTES.forEach((note, n) => {
        const drop = (data, r) => data[w][r][s][n].rel[0] - data[w][0][s][n].rel[0];
        const cols = [1, 2, 3].map((r) => `${fixed(drop(acb, r), 7)} ${fixed(drop(win, r), 7)}`);
        lines.push(`${wave.padEnd(7)} ${fixed(section, 6, 2)}%  ${String(note).padStart(4)}  ${cols.join(' ')}`);
      }),
    ),
  );
  return lines.join('\n');
}

/**
 * The harmonics both sources hold above the floor in one cell, as `[h, ACB,
 * Windsor]` triples (h from 0 for the fundamental). For the square only the
 * odd harmonics: the ACB's square carries even harmonics (H2 16 dB under H1
 * at 0 % resonance) and Windsor's `SQUARE` none, an oscillator difference the
 * filter's numbers should not carry.
 */
function heard(a, b, wave) {
  const out = [];
  const stride = wave === 'square' ? 2 : 1;
  for (let h = 0; h < HARMONICS && h < a.length && h < b.length; h += stride) {
    if (a[h] >= FLOOR_DB && b[h] >= FLOOR_DB) out.push([h, a[h], b[h]]);
  }
  return out;
}

/**
 * Windsor minus ACB over one wave's cells at resonance `r`, RMS dB: `shape`
 * is harmonics 2–16 against each note's own fundamental, `level` harmonics
 * 1–16 against the reference.
 */
function errors(acb, win, w, r, sections = SECTIONS.map((_, s) => s)) {
  const shape = [];
  const level = [];
  for (const s of sections) {
    NOTES.forEach((_, n) => {
      const a = acb[w][r][s][n].rel;
      const b = win[w][r][s][n].rel;
      for (const [h, x, y] of heard(a, b, WAVES[w])) {
        level.push(y - x);
        if (h > 0) shape.push(y - b[0] - (x - a[0]));
      }
    });
  }
  return { shape: rms(shape), level: rms(level) };
}

/**
 * The bass loss, Windsor minus ACB, RMS and mean dB over notes 33 and 45 (57
 * reads the emphasis on its fundamental at the low sections) and 50, 90 and
 * 100 % resonance, in `sections`.
 */
function bassError(acb, win, sections) {
  const diffs = [];
  WAVES.forEach((_, w) =>
    sections.forEach((s) =>
      [0, 1].forEach((n) =>
        [1, 2, 3].forEach((r) => {
          const drop = (data) => data[w][r][s][n].rel[0] - data[w][0][s][n].rel[0];
          diffs.push(drop(win) - drop(acb));
        }),
      ),
    ),
  );
  return `RMS ${rms(diffs).toFixed(2)}, mean ${mean(diffs).toFixed(2)}`;
}

/** The errors per wave and resonance, the 0 % shape per section and the bass loss: for comparing variants. */
export function errorTable(acb, win) {
  const lines = ['wave    res   shape RMS dB (H2–16 vs H1)   level RMS dB (H1–16 vs reference)   (square: odd harmonics)'];
  WAVES.forEach((wave, w) =>
    RESONANCES.forEach(({ travel }, r) => {
      const e = errors(acb, win, w, r);
      lines.push(`${wave.padEnd(7)} ${pct(travel)}  ${fixed(e.shape, 8, 2)}                    ${fixed(e.level, 8, 2)}`);
    }),
  );
  WAVES.forEach((wave, w) => {
    const bySection = SECTIONS.map((section, s) => `${section}% ${errors(acb, win, w, 0, [s]).shape.toFixed(2)}`);
    lines.push(`${wave} at 0 % resonance, shape RMS by Cut Off section: ${bySection.join(', ')}`);
  });
  lines.push(`bass loss, Windsor minus ACB, dB: 24.78 and 49.38 % sections ${bassError(acb, win, [0, 1])}; every section ${bassError(acb, win, [0, 1, 2, 3])}`);
  return lines.join('\n');
}
