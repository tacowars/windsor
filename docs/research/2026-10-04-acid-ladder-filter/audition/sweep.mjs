/* global console, process */
/**
 * The sweep each acid patch plays (windsor#574, acceptance 2): one note,
 * A2 (MIDI 45), held 0.6 s at the audition song's part velocity, plain and
 * accented (velocity + 0.2 and a mod of 1, as the Grid sends an accent),
 * through the shipped bundle; in 43 ms windows every 21 ms, the resonance's
 * emphasis (the neighbouring harmonics that rose most against the same note
 * with the Reso knob at its bottom, `../reference/spectrum.mjs`) and its
 * lift. The emphasis is the resonant peak: its frequency falls as the
 * filter envelope decays, and an accent starts it higher. First, each
 * patch's peak with C2 and C3 held 1 s at velocity 1 over seeds 0–3, the
 * clip check the acceptance names (the editor's check warns over 1).
 *
 *   node sweep.mjs [patch id]...      (default: the three acid patches)
 */
import { resolvePatch } from '../../../../scripts/sound-match/render.mjs';
import { emphasis, harmonicLevels, spectrum } from '../reference/spectrum.mjs';
import { SR, loadVariant, renderEvents, renderNote } from './bundleVariant.mjs';

const NOTE = 45;
const F0 = 110;
const VELOCITY = 0.8;
const ACCENT = { velocity: 0.2, mod: 1 };
const SECONDS = 0.6;
const WINDOW = 2048;
const HOP = 1024;
/** A harmonic the flat note holds this far under its strongest is left out (a square's even ones). */
const FLOOR_BELOW_DB = 60;
const RESO_BOTTOM = 0.5;

function render(variant, patch, accent) {
  const on = { type: 'noteOn', id: 1, note: NOTE, velocity: VELOCITY, frame: 0 };
  if (accent) Object.assign(on, { velocity: VELOCITY + ACCENT.velocity, mod: ACCENT.mod });
  return renderEvents(variant, patch, [on], { seconds: SECONDS });
}

/** Each window's emphasis: `{ ms, hz, lift }`. */
function track(variant, patch, accent) {
  const wet = render(variant, patch, accent);
  const flat = render(variant, { ...patch, filter: { ...patch.filter, resonance: RESO_BOTTOM } }, accent);
  const out = [];
  for (let at = 0; at + WINDOW <= wet.length; at += HOP) {
    const levels = harmonicLevels(spectrum(wet, SR, at, at + WINDOW), F0, SR / 2);
    const base = harmonicLevels(spectrum(flat, SR, at, at + WINDOW), F0, SR / 2);
    const floor = Math.max(...base) - FLOOR_BELOW_DB;
    out.push({ ms: ((at + WINDOW / 2) / SR) * 1000, ...emphasis(levels, base, F0, floor) });
  }
  return out;
}

/** The loudest sample of C2 and C3 held 1 s at velocity 1, over four seeds, in dBFS. */
function clipCheck(variant, patch) {
  let peak = 0;
  for (const note of [36, 48]) {
    for (let seed = 0; seed < 4; seed++) {
      const samples = renderNote(variant, patch, { note, velocity: 1, seconds: 1.5, gate: 1, seed });
      for (const s of samples) peak = Math.max(peak, Math.abs(s));
    }
  }
  return 20 * Math.log10(peak);
}

const ids = process.argv.slice(2);
const variant = loadVariant();
for (const id of ids.length ? ids : ['acid-saw', 'acid-square', 'acid-accent']) {
  const patch = resolvePatch(id);
  const plain = track(variant, patch, false);
  const accented = track(variant, patch, true);
  console.log(`${id}: C2 and C3 at velocity 1 peak ${clipCheck(variant, patch).toFixed(1)} dBFS`);
  console.log(`${id}: window centre ms, emphasis Hz and lift dB, plain | accented`);
  plain.forEach((p, i) => {
    const a = accented[i];
    console.log(
      `  ${p.ms.toFixed(0).padStart(4)}  ${p.hz.toFixed(0).padStart(5)} ${p.lift.toFixed(1).padStart(5)}  | ${a.hz.toFixed(0).padStart(5)} ${a.lift.toFixed(1).padStart(5)}`,
    );
  });
}
