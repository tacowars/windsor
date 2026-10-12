/**
 * The plate's voicing (windsor#746), the block-rate half: which row of
 * `reverbVoicingTables.ts` the tank reads (`plate` at 0, `room` at 1), and the
 * duck that keeps a switch from clicking.
 *
 * A row is data, so a switch is a swap of the arrays the tank reads at a block
 * boundary. Read through the same tank, the new taps and input lengths would
 * step on the next quantum, so a change of voicing ducks:
 * - the wet output and the tank's feed fade to zero over
 *   `INSERT_SWITCH_FADE_S`, a sample at a time in the tank's loop. Throughout,
 *   the plate renders with a snapshot of every parameter as it stood the block
 *   before the change, so a starting point that writes every field at once is
 *   heard only after the silence;
 * - at the first block boundary at silence the new row and the new field
 *   values apply together: both input chains and both Build lines are emptied
 *   (their contents were written for the old lengths), the taps and the input
 *   lengths land on the new row's outright, and Build lands on its parameter;
 * - the wet output and the feed fade back in over the same time.
 *
 * The tank's loop is never cleared, so the tail carries on through the new
 * taps; its own lines keep their Size ramp. The feed is ducked with the
 * output so the emptied chains restart under a fade rather than as a step
 * into the tail. A change that arrives while the fade is going down is taken
 * at its silence, with no second duck: the row applied there is the one asked
 * for then, and if that is the row already playing nothing is swapped. One
 * that arrives while the fade comes back up turns it round from where it
 * stands. A fresh plate, or one woken from sleep, applies the asked row at
 * once on its first block: its tank is empty (`resetVoicing` from `_sleep`).
 *
 * Invariants: nothing allocated after construction (the snapshot is made
 * there), no double across a call (worklet rule 2), and nothing here runs per
 * sample: the duck's gain is written out in the tank's loop (rule 6).
 * `mixer/reverbVoicing.test.ts` holds the switch, the sleep and the rows;
 * `mixer/reverbGolden.test.ts` pins the render.
 */

import { INSERT_SWITCH_FADE_S } from '../../inserts/insertConstants';
import { INPUT_DIFFUSERS, TANK_LINE_END } from './reverbConstants';
import type { DattorroReverb } from './reverbProcessor';
import { VOICING_ROOM_AT, VOICING_ROWS } from './reverbVoicingTables';

/** The duck's states: none, going down to silence, coming back up. */
const DUCK_IDLE = 0;
const DUCK_OUT = 1;
const DUCK_IN = 2;

/**
 * The voicing's state, from the processor's constructor, after its double
 * fields are first written as NaN (worklet rule 7): the snapshot, one
 * one-sample array per parameter, and the plate row applied.
 */
function makeVoicing(plate: DattorroReverb, names: readonly string[]): void {
  plate._paramNames = names;
  plate._snapshot = {};
  for (const name of names) plate._snapshot[name] = new Float32Array(1);
  plate._duck = 1;
  plate._duckStep = 0;
  plate._duckState = DUCK_IDLE;
  plate._voicingPrimed = false;
  plate._landVoicing = false;
  applyVoicing(plate, 0, false);
}

/**
 * Point the plate at row `voicing`'s tables, set its input lines' nominal
 * lengths, and have the next `_applySize` land the taps and input lengths
 * outright and the next `configureBuild` land Build. `clear` empties both
 * input chains and both Build lines, as a switch mid-tail needs.
 */
function applyVoicing(plate: DattorroReverb, voicing: number, clear: boolean): void {
  const row = VOICING_ROWS[voicing];
  plate._voicing = voicing;
  plate._tapTime = row.tapTime;
  plate._tapLine = row.tapLine;
  plate._tapGain = row.tapGain;
  plate._outputTrim = row.outputTrim;
  plate._buildTapTime = row.buildTapTime;
  plate._buildGainRows = row.buildGainRows;
  plate._buildDirectRows = row.buildDirectRows;
  plate._inputFollowsSize = row.inputFollowsSize;
  for (let k = 0; k < INPUT_DIFFUSERS; k++) {
    plate._nominal[k] = row.inputDelays[k] * sampleRate;
    plate._nominal[TANK_LINE_END + k] = row.inputDelays[INPUT_DIFFUSERS + k] * sampleRate;
  }
  plate._landVoicing = true;
  plate._buildPrimed = false;
  if (!clear) return;
  for (let k = 0; k < INPUT_DIFFUSERS; k++) {
    plate._buffers[k].fill(0);
    plate._buffers[TANK_LINE_END + k].fill(0);
  }
  plate._buildLine.fill(0);
  plate._buildLineRight.fill(0);
}

/** Back to a fresh plate's state, from `_sleep`: no duck, and the next block applies the asked row. */
function resetVoicing(plate: DattorroReverb): void {
  plate._duck = 1;
  plate._duckStep = 0;
  plate._duckState = DUCK_IDLE;
  plate._voicingPrimed = false;
}

/** Every parameter's value this block into the snapshot, which a duck renders with. */
function keepSnapshot(plate: DattorroReverb, parameters: Record<string, Float32Array>): void {
  const names = plate._paramNames;
  const snapshot = plate._snapshot;
  for (let k = 0; k < names.length; k++) snapshot[names[k]][0] = parameters[names[k]][0];
}

/**
 * This block's voicing, once a block before the tank renders: starts, runs
 * or ends a duck, applies a row at silence, and returns the parameters the
 * block renders with: the snapshot while the duck goes down, the live ones
 * otherwise.
 */
function voicingBlock(
  plate: DattorroReverb,
  parameters: Record<string, Float32Array>,
): Record<string, Float32Array> {
  const asked = parameters.voicing[0] >= VOICING_ROOM_AT ? 1 : 0;
  if (!plate._voicingPrimed) {
    // Fresh or woken: the tank is empty, so the asked row applies at once.
    if (asked !== plate._voicing) applyVoicing(plate, asked, false);
    plate._voicingPrimed = true;
  } else if (plate._duckState === DUCK_OUT) {
    if (plate._duck > 0) return plate._snapshot;
    // Silence: the row asked for now, if it is not the one playing, and the
    // live fields, then back up.
    if (asked !== plate._voicing) applyVoicing(plate, asked, true);
    plate._duckState = DUCK_IN;
    plate._duckStep = 1 / (INSERT_SWITCH_FADE_S * sampleRate);
  } else if (asked !== plate._voicing) {
    // Down from wherever the duck stands, rendering what was set before.
    plate._duckState = DUCK_OUT;
    plate._duckStep = -1 / (INSERT_SWITCH_FADE_S * sampleRate);
    return plate._snapshot;
  }
  keepSnapshot(plate, parameters);
  return parameters;
}

/** After the tank's loop has left the duck's gain in `_duck`: a duck that has come back up is over. */
function endVoicingBlock(plate: DattorroReverb): void {
  if (plate._duckState === DUCK_IN && plate._duck >= 1) {
    plate._duckState = DUCK_IDLE;
    plate._duckStep = 0;
  }
}

export { DUCK_IDLE, applyVoicing, endVoicingBlock, makeVoicing, resetVoicing, voicingBlock };
