/**
 * Hard sync on the voice (windsor#646, record `2026-10-09-operator-hard-sync`):
 * an operator's own phase accumulator restarts each time its master's own
 * accumulator wraps, the master being the note itself (a per-voice phase at
 * the note's frequency) or another operator, whatever that one's level,
 * wave, fixed mode or detune. Phase modulation the synced operator receives
 * still applies over the restarted phase; FM on a master never moves its
 * wraps. A forced reset counts as a wrap for the operators synced to the
 * reset one, so a chain resets in chain order within the sample.
 *
 * Where a master wrapped `d` of a sample before the next sample (its phase
 * after the wrap over its increment), the synced operator's phase becomes
 * `d` times its own increment. The step that makes, the wave just after the
 * reset less the wave it would have read without it (both at the sample's
 * phase modulation and width, before the operator's own filters and its
 * level), is smoothed by a two-sample polyBLEP (`SYNC_BLEP_GAIN`): so that
 * the sample before can be corrected, a corrected operator sends its wave
 * on a sample late, to every carrier it modulates and to the carrier sum,
 * while its feedback taps keep the raw wave. The deliberately aliasing waves
 * (Saw D, Square D, Sine 4bit, Sine 8bit) take the reset uncorrected and
 * undelayed. A synced Noise operator's draw has no phase, so its sync does
 * nothing; a Noise operator as a master syncs by its phase accumulator,
 * which the generic loop advances like any other operator's.
 *
 * Invariant: a voice with no synced operator has `synced` 0, takes the
 * kernel (`bindVoiceConstants`) and never reaches this module in a render;
 * the generic loop tests the masters' wraps itself and calls
 * `applySyncResets` only on a sample where one wrapped. Allocation free,
 * and no double crosses a call: the wave reads pass through `SYNC_POINT`.
 * `voiceSync.test.ts` pins the binding and the chain order;
 * `synth/fmProcessorSync.test.ts` the render; `fmProcessorAllocation.test.ts`
 * the allocation.
 */

import type { Patch } from '../../patch/patch';
import type { Voice } from './voice';
import { SYNC_BLEP_GAIN, TABLE_SIZE } from './fmConstants';
import type { OpSync } from './patchDefaults';
import { OPERATOR_COUNT, OP_SYNC_OPERATORS } from './patchDefaults';
import { WAVE } from './waveIds';
import { KIND_NOISE, KIND_PULSE, KIND_TABLE } from './waveTables';

/** A master in `VoiceSync.master`: none, an operator's index, or the note. */
const SYNC_NONE = -1;
const SYNC_NOTE = OPERATOR_COUNT;
/** The note's bit in `VoiceSync.masters`, past the four operators' bits. */
const SYNC_NOTE_BIT = 1 << SYNC_NOTE;

/** A wave read's phase in, its value out: no double crosses `syncWaveAt` (windsor#233). */
const SYNC_POINT = new Float64Array(1);

/** One voice's sync state: what the bound patch syncs, the note's phase, and the polyBLEP's. */
class VoiceSync {
  /** A bit per synced operator. */
  synced: number;
  /** A bit per synced operator whose reset is corrected, and so sent a sample late. */
  blep: number;
  /** A bit per master: an operator's own bit, `SYNC_NOTE_BIT` for the note. */
  masters: number;
  /** Each operator's master, `SYNC_NONE` when it is not synced. */
  master: Int32Array;
  /** The synced operators in chain order: each after the operator it follows. */
  order: Int32Array;
  count: number;
  /** The note master's phase and its increment this block (`advanceVoiceControl`). */
  notePhase: number;
  noteInc: number;
  /** Each corrected operator's phase modulation this sample, which its step is read at. */
  mod: Float64Array;
  /** Each corrected operator's wave from the sample before, with the correction that sample owes. */
  held: Float64Array;
  /** The correction each corrected operator's next wave owes, taken off as it is held. */
  after: Float64Array;

  constructor() {
    // Rule 7: each double field is born a double (NaN), before its start value.
    this.notePhase = this.noteInc = NaN;
    this.synced = 0;
    this.blep = 0;
    this.masters = 0;
    this.master = new Int32Array(OPERATOR_COUNT).fill(SYNC_NONE);
    this.order = new Int32Array(OPERATOR_COUNT);
    this.count = 0;
    this.notePhase = 0;
    this.noteInc = 0;
    this.mod = new Float64Array(OPERATOR_COUNT);
    this.held = new Float64Array(OPERATOR_COUNT);
    this.after = new Float64Array(OPERATOR_COUNT);
  }

  /** A note from rest: the note's phase at 0 and nothing held. A legato retarget keeps both. */
  start(): void {
    this.notePhase = 0;
    this.held.fill(0);
    this.after.fill(0);
  }
}

/** The master a sync field names, by string, at a bind: never in a render. */
function syncMasterOf(sync: OpSync): number {
  if (sync === 'note') return SYNC_NOTE;
  return OP_SYNC_OPERATORS.indexOf(sync);
}

/** Whether a reset on this wave is smoothed: every table wave and the Pulse but the deliberately aliasing ones. */
function syncCorrected(kind: number, wave: number): boolean {
  if (kind === KIND_PULSE) return true;
  return kind === KIND_TABLE && wave !== WAVE.SINE_4BIT && wave !== WAVE.SINE_8BIT;
}

/**
 * The bound patch's sync onto the voice, after `kind` is set: each
 * operator's master, the bits, and the chain order (an operator after the
 * one it follows; an operator in a cycle, which the normaliser already
 * turned off, would be left unsynced). An operator newly corrected starts
 * with nothing held. Called by `bindVoiceConstants` at a note-on, a rebind
 * and a retarget. Allocates nothing.
 */
function bindVoiceSync(voice: Voice, patch: Patch): void {
  const s = voice.sync;
  const master = s.master;
  let synced = 0;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const m = voice.kind[i] === KIND_NOISE ? SYNC_NONE : syncMasterOf(patch.ops[i].sync);
    master[i] = m;
    if (m !== SYNC_NONE) synced |= 1 << i;
  }
  let placed = 0;
  let count = 0;
  for (let pass = 0; pass < OPERATOR_COUNT; pass++) {
    for (let i = 0; i < OPERATOR_COUNT; i++) {
      const bit = 1 << i;
      const m = master[i];
      if ((synced & bit) === 0 || (placed & bit) !== 0) continue;
      if (m === SYNC_NOTE || (synced & (1 << m)) === 0 || (placed & (1 << m)) !== 0) {
        s.order[count++] = i;
        placed |= bit;
      }
    }
  }
  let blep = 0;
  let masters = 0;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    if ((placed & (1 << i)) === 0) {
      master[i] = SYNC_NONE;
      continue;
    }
    masters |= 1 << master[i];
    if (syncCorrected(voice.kind[i], patch.ops[i].wave)) blep |= 1 << i;
  }
  const fresh = blep & ~s.blep;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    if ((fresh & (1 << i)) !== 0) s.held[i] = s.after[i] = 0;
  }
  s.synced = placed;
  s.blep = blep;
  s.masters = masters;
  s.count = count;
}

/**
 * Operator `i`'s wave at the phase in `SYNC_POINT`, left there: the generic
 * loop's read for a corrected wave, its width squeeze included, before its
 * own filters. A Pulse reads its saw twice, a duty apart.
 */
function syncWaveAt(voice: Voice, i: number): void {
  const t = voice.tables[i]!;
  const ph = SYNC_POINT[0];
  const width = voice.width[i];
  let x = ph;
  let pd = 0;
  if (voice.kind[i] === KIND_PULSE) {
    pd = ph + width;
    pd -= Math.floor(pd);
  } else {
    x = ph * width;
    if (x >= 1) {
      SYNC_POINT[0] = 0;
      return;
    }
  }
  const fi = x * TABLE_SIZE;
  const i0 = fi | 0;
  const s0 = t[i0];
  let v = s0 + (t[i0 + 1] - s0) * (fi - i0);
  if (voice.kind[i] === KIND_PULSE) {
    const fd = pd * TABLE_SIZE;
    const d0 = fd | 0;
    const sd = t[d0];
    v -= sd + (t[d0 + 1] - sd) * (fd - d0);
  }
  SYNC_POINT[0] = v;
}

/**
 * The resets of a sample on which a master wrapped, after every operator
 * has advanced: in chain order, each synced operator whose master's phase
 * sits below that master's increment (it wrapped, or was reset, this
 * sample) restarts at `d` times its own increment. A corrected operator's
 * step is read at this sample's phase modulation, and the polyBLEP's two
 * halves go onto the wave it holds and the one it reads next.
 */
function applySyncResets(voice: Voice): void {
  const s = voice.sync;
  const phase = voice.phase;
  const phaseInc = voice.phaseInc;
  for (let k = 0; k < s.count; k++) {
    const i = s.order[k];
    const m = s.master[i];
    const pm = m === SYNC_NOTE ? s.notePhase : phase[m];
    const im = m === SYNC_NOTE ? s.noteInc : phaseInc[m];
    if (!(pm < im && im > 0)) continue;
    const d = pm / im;
    const free = phase[i];
    const reset = d * phaseInc[i];
    phase[i] = reset;
    if ((s.blep & (1 << i)) === 0) continue;
    const mod = s.mod[i];
    let ph = reset + mod;
    SYNC_POINT[0] = ph - Math.floor(ph);
    syncWaveAt(voice, i);
    const after = SYNC_POINT[0];
    ph = free + mod;
    SYNC_POINT[0] = ph - Math.floor(ph);
    syncWaveAt(voice, i);
    const step = after - SYNC_POINT[0];
    const e = 1 - d;
    s.held[i] += step * d * d * SYNC_BLEP_GAIN;
    s.after[i] = step * e * e * SYNC_BLEP_GAIN;
  }
}

export { SYNC_NONE, SYNC_NOTE, SYNC_NOTE_BIT, VoiceSync, applySyncResets, bindVoiceSync };
