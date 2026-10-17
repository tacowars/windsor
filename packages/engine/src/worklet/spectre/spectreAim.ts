/**
 * Spectre's per-frame aim (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells` decision 6): one channel's curve moves
 * and modulation amounts for the coming frame, from the glided controls, the
 * LFO's three slots and the channel's side.
 *
 * - Spread slides all three curves by `side · spread` octaves.
 * - Each LFO slot adds `depth · lfo` to its destination
 *   (`SPECTRE_LFO_DESTS`): a curve's Offset or Select as a share of full
 *   scale, a curve's Shift as `lfoShiftOctaves` octaves at depth 1, or the
 *   first amount, held to 0..1. Two slots on one destination add.
 * - The delay's full scale and the grid come from the DSP's `timeFrames` and
 *   `gridFrames`; a band's delay is held to the DSP's `reach`.
 *
 * Invariants: nothing allocates and no double crosses a call: the slots sum
 * into the DSP's `pushes` (worklet rule 2). Pinned by
 * `inserts/spectreBands.test.ts`.
 */
import { SPECTRE_DSP, SPECTRE_LFO_DESTS } from '../../inserts/spectreConstants';
import type { SpectreChannel } from './spectreChannel';
import {
  SLOT_DELAY_OFFSET,
  SLOT_DELAY_SELECT,
  SLOT_DELAY_SHIFT,
  SLOT_FEEDBACK_OFFSET,
  SLOT_FEEDBACK_SELECT,
  SLOT_FEEDBACK_SHIFT,
  SLOT_GAIN_OFFSET,
  SLOT_GAIN_SELECT,
  SLOT_GAIN_SHIFT,
  SLOT_LFO_DEPTH,
  SLOT_MOD_A,
  SLOT_MOD_B,
  SLOT_MOD_C,
  SLOT_SCATTER,
  SLOT_SPREAD,
  SPECTRE_LFO_SLOTS,
} from './spectreControls';
import type { SpectreControls } from './spectreControls';
import type { SpectreLfo } from './spectreLfo';

/** Each destination's index in `SPECTRE_LFO_DESTS`, and so in `pushes`. */
const PUSH_GAIN_SHIFT = 0,
  PUSH_DELAY_SHIFT = 1,
  PUSH_FEEDBACK_SHIFT = 2,
  PUSH_GAIN_OFFSET = 3,
  PUSH_DELAY_OFFSET = 4,
  PUSH_FEEDBACK_OFFSET = 5,
  PUSH_GAIN_SELECT = 6,
  PUSH_DELAY_SELECT = 7,
  PUSH_FEEDBACK_SELECT = 8,
  PUSH_MOD_A = 9;
const PUSHES = SPECTRE_LFO_DESTS.length;

/** What the aim reads of the DSP. */
interface SpectreAimSource {
  readonly controls: SpectreControls;
  readonly lfo: SpectreLfo;
  readonly freeze: number;
  readonly timeFrames: number;
  readonly gridFrames: number;
  readonly reach: number;
  /** The LFO's sum into each destination this frame, `SPECTRE_LFO_DESTS` long. */
  readonly pushes: Float64Array;
}

/** The LFO's three slots summed into `dsp.pushes`, once a frame before either channel aims. */
function aimLfo(dsp: SpectreAimSource): void {
  const pushes = dsp.pushes,
    v = dsp.controls.value,
    dests = dsp.controls.lfoDests,
    lfo = dsp.lfo.value;
  pushes.fill(0);
  for (let s = 0; s < SPECTRE_LFO_SLOTS; s++) {
    const dest = dests[s];
    if (dest < 0 || dest >= PUSHES) continue;
    pushes[dest] += v[SLOT_LFO_DEPTH + s] * lfo;
  }
  const octaves = SPECTRE_DSP.lfoShiftOctaves;
  pushes[PUSH_GAIN_SHIFT] *= octaves;
  pushes[PUSH_DELAY_SHIFT] *= octaves;
  pushes[PUSH_FEEDBACK_SHIFT] *= octaves;
}

function aimChannel(dsp: SpectreAimSource, channel: SpectreChannel): void {
  const v = dsp.controls.value,
    push = dsp.pushes,
    map = channel.map,
    mods = channel.mods;
  const slide = channel.side * v[SLOT_SPREAD];
  map.gainShift = v[SLOT_GAIN_SHIFT] + slide + push[PUSH_GAIN_SHIFT];
  map.delayShift = v[SLOT_DELAY_SHIFT] + slide + push[PUSH_DELAY_SHIFT];
  map.feedbackShift = v[SLOT_FEEDBACK_SHIFT] + slide + push[PUSH_FEEDBACK_SHIFT];
  map.gainOffset = v[SLOT_GAIN_OFFSET] + push[PUSH_GAIN_OFFSET];
  map.delayOffset = v[SLOT_DELAY_OFFSET] + push[PUSH_DELAY_OFFSET];
  map.feedbackOffset = v[SLOT_FEEDBACK_OFFSET] + push[PUSH_FEEDBACK_OFFSET];
  map.gainSelect = v[SLOT_GAIN_SELECT] + push[PUSH_GAIN_SELECT];
  map.delaySelect = v[SLOT_DELAY_SELECT] + push[PUSH_DELAY_SELECT];
  map.feedbackSelect = v[SLOT_FEEDBACK_SELECT] + push[PUSH_FEEDBACK_SELECT];
  map.scatter = v[SLOT_SCATTER];
  map.timeFrames = dsp.timeFrames;
  map.gridFrames = dsp.gridFrames;
  map.limit = dsp.reach;
  channel.memory.freeze = dsp.freeze;
  channel.memory.lift = dsp.controls.freezeMode === 1 ? 0 : 1;
  const a = v[SLOT_MOD_A] + push[PUSH_MOD_A];
  mods.a = a < 0 ? 0 : a > 1 ? 1 : a;
  mods.b = v[SLOT_MOD_B];
  mods.c = v[SLOT_MOD_C];
}

export { aimChannel, aimLfo };
