/**
 * windsor#652's candidates, applied in memory to the shipped FM bundle's
 * text as the diagnostic renders were: nothing under `packages/` changes.
 * Research only.
 *
 * - `direct(text, points)`: candidates A (`points` 2) and C (4), a direct
 *   shape with a polyBLEP on every edge (`directBundle.mjs`).
 * - `fineRatio(text)`: candidate D, the fine control interval for a voice
 *   whose ratio an LFO modulates.
 * - `scaledIntervals(text, k)`: the control intervals at `k` times their
 *   length in samples, so a voice rendered at `k` times the rate (candidate
 *   B, and the 16× reference's second row) updates its controls as often as
 *   it does at 48 kHz.
 */
import { DIRECT_EDITS } from './directBundle.mjs';

/** `text` with its one `from` replaced by `to`; refuses a missing or repeated `from`. */
export function replaceOnce(text, from, to) {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`the bundle has no "${from.slice(0, 80)}"`);
  if (text.indexOf(from, at + 1) >= 0) throw new Error(`"${from.slice(0, 80)}" is not unique`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** Candidates A and C: every edit of `directBundle.mjs`, with a `points`-point polyBLEP. */
export function direct(text, points) {
  let out = text;
  for (const edit of DIRECT_EDITS(points)) out = replaceOnce(out, edit.from, edit.to);
  return out;
}

/**
 * Candidate D: a voice an LFO's `toRatio` reaches, with a depth (its amount
 * or its wheel depth), keeps the fine interval at any rate and shape. A
 * build would add the step, song-lane and macro sources of
 * `ops.<i>.ratio`; `lead-sync-sweep` uses only the LFO.
 */
export function fineRatio(text) {
  return replaceOnce(
    text,
    'function controlInterval(voice, table = CONTROL_INTERVALS) {\n  if (voice.fbRamp !== 0) return table.fine;',
    `function controlInterval(voice, table = CONTROL_INTERVALS) {
  if (voice.fbRamp !== 0) return table.fine;
  {
    const lp = voice.patch.lfo, lp2 = voice.patch.lfo2;
    const on = voice.liveValues[VT_LFO_AMOUNT] !== 0 || lp.modWheelDepth !== 0;
    const on2 = voice.liveValues[VT_LFO2_AMOUNT] !== 0 || lp2.modWheelDepth !== 0;
    for (let i = 0; i < 4; i++) {
      if ((on && lp.toRatio[i] !== 0) || (on2 && lp2.toRatio[i] !== 0)) return table.fine;
    }
  }`,
  );
}

/** Both control intervals `k` times as long in samples: the same rate in time at `k` times the sample rate. */
export function scaledIntervals(text, k) {
  let out = replaceOnce(text, 'var CTRL_INTERVAL = 32;', `var CTRL_INTERVAL = ${32 * k};`);
  out = replaceOnce(out, 'var CTRL_INTERVAL_LONG = 128;', `var CTRL_INTERVAL_LONG = ${128 * k};`);
  return out;
}
