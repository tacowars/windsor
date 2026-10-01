/**
 * The worklet's voice target rows (windsor#346) against the automation
 * catalog the main thread draws and schedules from: every voice row but the
 * cutoff (`cutoffMod`) and the nine decay rows (windsor#347) has a slot
 * target here, with the catalog's bounds, and the slots are the main
 * thread's `FM_LANES_MAX`, named as `AudioPart` reads them.
 */
import { describe, expect, it } from 'vitest';

import { FM_LANES_MAX, VOICE_AUTOMATION_ROWS } from '../../automation/automationTargetTables';
import {
  OFFSET_ADD,
  OFFSET_RATIO,
  VOICE_OFFSET_CURVE,
  VOICE_OFFSET_MAX,
  VOICE_OFFSET_MIN,
  VOICE_OFFSET_TABLE,
  VOICE_SLOT_COUNT,
  VOICE_SLOT_PARAMS,
  VOICE_TARGET_COUNT,
  VT_LFO2_RATE,
  VT_LFO_RATE,
  VT_OP_BASE,
  VT_OP_FEEDBACK,
  VT_OP_LEVEL,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
  voiceTargetCode,
} from './voiceOffsetTables';

const VOICE = 'voice.';
const slotRows = VOICE_AUTOMATION_ROWS.filter(
  (row) => row.target !== 'voice.filter.cutoff' && !/\.decay(Time|Curve)$/.test(row.target),
);

describe('the voice offset table (windsor#346)', () => {
  it("carries every slot target of the catalog, in the catalog's order", () => {
    expect(slotRows).toHaveLength(19);
    expect(VOICE_OFFSET_TABLE.map((row) => `${VOICE}${row.path}`)).toEqual(
      slotRows.map((row) => row.target),
    );
    expect(VOICE_TARGET_COUNT).toBe(VOICE_OFFSET_TABLE.length);
  });

  it("clamps each target to its catalog row's bounds", () => {
    for (const row of slotRows) {
      const k = voiceTargetCode(row.target.slice(VOICE.length));
      expect([VOICE_OFFSET_MIN[k], VOICE_OFFSET_MAX[k]]).toEqual([row.min, row.max]);
    }
  });

  it('scales the LFO rates by a ratio and offsets the rest', () => {
    VOICE_OFFSET_CURVE.forEach((curve, k) => {
      expect(curve).toBe(k === VT_LFO_RATE || k === VT_LFO2_RATE ? OFFSET_RATIO : OFFSET_ADD);
    });
  });

  it("lays each operator's rows out from its base", () => {
    for (let i = 0; i < 4; i++) {
      const b = VT_OP_BASE + i * VT_OP_STRIDE;
      expect(voiceTargetCode(`ops.${i}.level`)).toBe(b + VT_OP_LEVEL);
      expect(voiceTargetCode(`ops.${i}.feedback`)).toBe(b + VT_OP_FEEDBACK);
      expect(voiceTargetCode(`ops.${i}.width`)).toBe(b + VT_OP_WIDTH);
    }
  });

  it('maps no slot to the cutoff, a decay row or junk', () => {
    for (const path of ['filter.cutoff', 'ops.0.env.decayTime', 'volume', '', null, 3]) {
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
