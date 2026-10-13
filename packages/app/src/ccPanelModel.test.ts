/**
 * The MIDI CC panel's rows (windsor#784, record `2026-10-13-midi-cc-mapping`
 * and its mockup): which rows each filter lists, learn's new row, the Live
 * cell's words for every status, the pickup line through the engine's curve,
 * and the Source cell's device and channel choices.
 */
import {
  type CcMapping,
  type CcTargetId,
  makeArrangement,
  requireCatalogRow,
} from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import {
  CC_ANY,
  type CcRowState,
  ccChannelOptions,
  ccDeviceOptions,
  ccLiveView,
  ccMappingCount,
  ccRows,
  pickupHint,
} from './ccPanelModel';
import { readout } from './automationReadout';
import { addPart, newSong } from './songParts';

const LEVEL: CcTargetId = 'voice.ops.0.level';
const CUTOFF: CcTargetId = 'voice.filter.cutoff';

const mapping = (target: CcTargetId, o: Partial<CcMapping> = {}): CcMapping => ({
  source: { device: 'Keys', channel: 1, cc: 74 },
  target,
  min: 0,
  max: 1,
  inverted: false,
  ...o,
});

/** Two parts; slot 0 maps Level, slot 1 maps Cutoff. */
function song() {
  const two = makeArrangement(addPart(makeArrangement(newSong()).document)?.doc).document;
  return makeArrangement({
    ...two,
    parts: two.parts.map((part) => ({
      ...part,
      ccMappings: [part.slot === 0 ? mapping(LEVEL) : mapping(CUTOFF, { min: 2000, max: 6000 })],
    })),
  }).document;
}

const idle: CcRowState = {
  learning: null,
  heard: null,
  status: () => ({ kind: 'waiting', marker: null }),
  heardFrom: () => undefined,
  current: () => undefined,
};

describe('ccRows', () => {
  it('lists the selected part under This part, every part under All parts', () => {
    const doc = song();
    expect(ccRows(doc, 'this', 1, idle).map((r) => r.key)).toEqual([`1|${CUTOFF}`]);
    expect(ccRows(doc, 'all', 1, idle).map((r) => r.key)).toEqual([`0|${LEVEL}`, `1|${CUTOFF}`]);
    expect(ccMappingCount(doc, 0)).toBe(1);
  });

  it("names the target as the Song tab's lanes do, and reads the range in its units", () => {
    const [row] = ccRows(song(), 'this', 1, idle);
    expect(row).toMatchObject({
      name: 'Cutoff',
      kindLine: 'Voice · Filter',
      range: ['2.00 kHz', '6.00 kHz'],
    });
  });

  it("adds learn's row for an unmapped target, listening, and marks a mapped one listening", () => {
    const doc = song();
    const adding = { ...idle, learning: { part: 0, target: CUTOFF, added: true } };
    const rows = ccRows(doc, 'this', 0, adding);
    expect(rows.map((r) => [r.target, r.listening, r.mapping === null])).toEqual([
      [LEVEL, false, false],
      [CUTOFF, true, true],
    ]);
    expect(rows[1]?.source).toEqual({ kind: 'listening' });
  });

  it('shows what learn just heard, then where the mapping last heard from', () => {
    const doc = song();
    const source = { device: 'Keys', channel: 1, cc: 74 };
    const heard = { ...idle, heard: { part: 0, target: LEVEL, source } };
    expect(ccRows(doc, 'this', 0, heard)[0]?.source).toEqual({
      kind: 'heard',
      cc: 74,
      rest: 'ch 1 · Keys',
    });
    const from = { ...idle, heardFrom: () => ({ device: 'Pads', channel: 2 }) };
    expect(ccRows(doc, 'this', 0, from)[0]?.source).toMatchObject({
      kind: 'set',
      heardLine: 'heard ch 2 · Pads',
      heardDevice: 'Pads',
    });
  });
});

describe('ccLiveView', () => {
  const format = (v: number): string => v.toFixed(2);
  const none = (): null => null;

  it('reads a held value, a dash before any, and each status with its line', () => {
    expect(ccLiveView({ kind: 'live', value: 0.3, held: true }, format, none)).toEqual({
      tone: 'value',
      text: '0.30',
      sub: null,
    });
    expect(ccLiveView({ kind: 'live', value: 0.8, held: false }, format, none).tone).toBe('none');
    expect(ccLiveView({ kind: 'automated' }, format, none).text).toBe('Automated');
    expect(ccLiveView({ kind: 'inert', reason: 'no Macro 2 in this patch' }, format, none)).toEqual(
      {
        tone: 'inert',
        text: 'Inert',
        sub: 'no Macro 2 in this patch',
      },
    );
    expect(ccLiveView({ kind: 'noSlot' }, format, none).text).toBe('No voice slot');
    expect(ccLiveView({ kind: 'waiting', marker: null }, format, none).tone).toBe('none');
    const waiting = ccLiveView(
      { kind: 'waiting', marker: { cc: 100, value: 0.21 } },
      format,
      () => 'turn past CC 25',
    );
    expect(waiting).toEqual({
      tone: 'pickup',
      text: 'Waiting for pickup',
      sub: 'at 0.21 · turn past CC 25',
    });
  });
});

describe('pickupHint', () => {
  it("names the CC where the target's value sits, the way the knob travels to it", () => {
    // The mockup's Op B Decay: 50 ms–2 s over a 400 ms patch, heard at CC 10.
    const row = requireCatalogRow('voice.ops.1.env.decayTime');
    const decay = mapping('voice.ops.1.env.decayTime', { min: 0.05, max: 2 });
    const format = (v: number): string => readout(row, v);
    expect(pickupHint(row, decay, 0.4, 10, format)).toBe('turn past CC 72 (405 ms) to take 400 ms');
    // A 1 kHz cutoff under a 2–6 kHz range picks up at the range's bottom.
    const cutoff = mapping(CUTOFF, { min: 2000, max: 6000 });
    const hz = requireCatalogRow(CUTOFF);
    expect(pickupHint(hz, cutoff, 1000, 64, (v) => readout(hz, v))).toBe(
      'turn to CC 0 (2.00 kHz): 1.00 kHz is outside the range',
    );
  });
});

describe('the Source choices', () => {
  it('offers Any, the connected inputs, and the mapping’s own and last-heard devices', () => {
    expect(ccDeviceOptions('Keys', ['Pads'], 'Old')).toEqual([
      { value: CC_ANY, label: 'Any device' },
      { value: 'Pads', label: 'Pads' },
      { value: 'Keys', label: 'Keys (disconnected)' },
      { value: 'Old', label: 'Old (disconnected)' },
    ]);
    const channels = ccChannelOptions(16);
    expect(channels).toHaveLength(17);
    expect(channels[0]).toEqual({ value: CC_ANY, label: 'Any ch' });
    expect(channels[16]).toEqual({ value: '16', label: 'ch 16' });
  });
});
