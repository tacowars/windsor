/**
 * The worklet's voice target rows (windsor#346, windsor#347) against the
 * automation catalog the main thread draws and schedules from: every voice
 * row but the cutoff (`cutoffMod`) has a slot target here, with the
 * catalog's bounds and floor, and the slots are the main thread's
 * `FM_LANES_MAX`, named as `AudioPart` reads them.
 */
import { describe, expect, it } from 'vitest';

import { FM_LANES_MAX, VOICE_AUTOMATION_ROWS } from '../../automation/automationTargetTables';
import {
  OFFSET_ADD,
  OFFSET_RATIO,
  VOICE_OFFSET_CURVE,
  VOICE_OFFSET_FLOOR,
  VOICE_OFFSET_MAX,
  VOICE_OFFSET_MIN,
  VOICE_OFFSET_TABLE,
  VOICE_SLOT_COUNT,
  VOICE_SLOT_PARAMS,
  VOICE_TARGET_COUNT,
  VT_LFO2_RATE,
  VT_LFO_RATE,
  VT_FILTER_DECAY,
  VT_OP_BASE,
  VT_OP_DECAY,
  VT_OP_DECAY_CURVE,
  VT_OP_FEEDBACK,
  VT_OP_LEVEL,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
  VT_VOWEL,
  voiceTargetCode,
} from './voiceOffsetTables';

const VOICE = 'voice.';
const slotRows = VOICE_AUTOMATION_ROWS.filter((row) => row.target !== 'voice.filter.cutoff');
const DECAY_TIME = /\.decayTime$/;

describe('the voice offset table (windsor#346)', () => {
  it("carries every slot target of the catalog, in the catalog's order", () => {
    expect(slotRows).toHaveLength(29);
    expect(VOICE_OFFSET_TABLE.map((row) => `${VOICE}${row.path}`)).toEqual(
      slotRows.map((row) => row.target),
    );
    expect(VOICE_TARGET_COUNT).toBe(VOICE_OFFSET_TABLE.length);
  });

  it("clamps each target to its catalog row's bounds, and floors a ratio at the row's floor", () => {
    for (const row of slotRows) {
      const k = voiceTargetCode(row.target.slice(VOICE.length));
      expect([VOICE_OFFSET_MIN[k], VOICE_OFFSET_MAX[k]]).toEqual([row.min, row.max]);
      expect(VOICE_OFFSET_FLOOR[k]).toBe(row.floor ?? 0);
    }
    expect(VOICE_OFFSET_FLOOR[VT_FILTER_DECAY]).toBe(0.001);
  });

  it('scales the LFO rates and the decay times by a ratio and offsets the rest', () => {
    VOICE_OFFSET_CURVE.forEach((curve, k) => {
      const ratio =
        k === VT_LFO_RATE || k === VT_LFO2_RATE || DECAY_TIME.test(VOICE_OFFSET_TABLE[k]!.path);
      expect(curve).toBe(ratio ? OFFSET_RATIO : OFFSET_ADD);
    });
    expect(VOICE_OFFSET_CURVE.filter((c) => c === OFFSET_RATIO)).toHaveLength(7);
  });

  it("lays each operator's rows out from its base", () => {
    for (let i = 0; i < 4; i++) {
      const b = VT_OP_BASE + i * VT_OP_STRIDE;
      expect(voiceTargetCode(`ops.${i}.level`)).toBe(b + VT_OP_LEVEL);
      expect(voiceTargetCode(`ops.${i}.env.decayTime`)).toBe(b + VT_OP_DECAY);
      expect(voiceTargetCode(`ops.${i}.env.decayCurve`)).toBe(b + VT_OP_DECAY_CURVE);
      expect(voiceTargetCode(`ops.${i}.feedback`)).toBe(b + VT_OP_FEEDBACK);
      expect(voiceTargetCode(`ops.${i}.width`)).toBe(b + VT_OP_WIDTH);
    }
    expect(voiceTargetCode('filter.env.decayTime')).toBe(VT_FILTER_DECAY);
  });

  it('adds the Formant vowel after the filter decay, over 0–4 (windsor#406)', () => {
    expect(voiceTargetCode('filter.vowel')).toBe(VT_VOWEL);
    expect(VT_VOWEL).toBe(VT_FILTER_DECAY + 1);
    expect(VOICE_OFFSET_CURVE[VT_VOWEL]).toBe(OFFSET_ADD);
    expect([VOICE_OFFSET_MIN[VT_VOWEL], VOICE_OFFSET_MAX[VT_VOWEL]]).toEqual([0, 4]);
    expect(VOICE_OFFSET_FLOOR[VT_VOWEL]).toBe(0);
  });

  it('maps no slot to the cutoff, a field no lane moves, or junk', () => {
    for (const path of ['filter.cutoff', 'ops.0.env.attackTime', 'volume', '', null, 3]) {
      expect(voiceTargetCode(path)).toBe(-1);
    }
  });

  it("has the main thread's slots, named as the part reads them (`voiceSlotParamName`)", () => {
    expect(VOICE_SLOT_COUNT).toBe(FM_LANES_MAX);
    expect(VOICE_SLOT_PARAMS).toEqual(
      Array.from({ length: FM_LANES_MAX }, (_, i) => `voiceSlot${i}`),
    );
  });
});
