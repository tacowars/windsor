import { CC_MAPPING_IGNORED, type CcMapping, requireCatalogRow } from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import type { CcMessage } from './ccEngine';
import { CcLearn, learnedMappings } from './ccLearn';

const cc = (n: number, value: number, device: string | null = 'Keys', channel = 1): CcMessage => ({
  device,
  channel,
  cc: n,
  value,
});

describe('CcLearn', () => {
  it('learns nothing from a value dump, one value per controller', () => {
    const learn = new CcLearn();
    for (let n = 0; n < 128; n++) expect(learn.hear(cc(n, (n * 37) % 128))).toBeNull();
    expect(learn.listening).toBe(true);
  });

  it('learns the first CC that moves 3 from its first value, with its device and channel', () => {
    const learn = new CcLearn();
    expect(learn.hear(cc(74, 60, 'Keys', 3))).toBeNull();
    expect(learn.hear(cc(74, 62, 'Keys', 3))).toBeNull();
    expect(learn.hear(cc(74, 58, 'Keys', 3))).toBeNull();
    expect(learn.hear(cc(74, 63, 'Keys', 3))).toEqual({ device: 'Keys', channel: 3, cc: 74 });
    expect(learn.listening).toBe(false);
    expect(learn.hear(cc(71, 0))).toBeNull();
  });

  it('measures the move per device and channel', () => {
    const learn = new CcLearn();
    learn.hear(cc(74, 60, 'Keys', 1));
    expect(learn.hear(cc(74, 64, 'Pads', 1))).toBeNull();
    expect(learn.hear(cc(74, 64, 'Keys', 2))).toBeNull();
    expect(learn.hear(cc(74, 64, 'Keys', 1))).toEqual({ device: 'Keys', channel: 1, cc: 74 });
  });

  it('ignores CC 1, CC 64 and every other controller on the ignored list', () => {
    const learn = new CcLearn();
    expect(CC_MAPPING_IGNORED.has(1) && CC_MAPPING_IGNORED.has(64)).toBe(true);
    for (const n of CC_MAPPING_IGNORED) {
      expect(learn.hear(cc(n, 0))).toBeNull();
      expect(learn.hear(cc(n, 127))).toBeNull();
    }
    expect(learn.listening).toBe(true);
  });

  it('learns an input with no name as Any device, keeping its channel', () => {
    const learn = new CcLearn();
    learn.hear(cc(20, 10, null, 5));
    expect(learn.hear(cc(20, 20, null, 5))).toEqual({ device: null, channel: 5, cc: 20 });
  });

  it('leaves nothing after Cancel', () => {
    const learn = new CcLearn();
    learn.hear(cc(74, 60));
    learn.cancel();
    expect(learn.listening).toBe(false);
    expect(learn.hear(cc(74, 100))).toBeNull();
  });
});

describe('learnedMappings', () => {
  const LEVEL = requireCatalogRow('voice.ops.0.level');
  const mapped: CcMapping = {
    source: { device: 'Keys', channel: 1, cc: 71 },
    target: 'voice.ops.0.level',
    min: 0.2,
    max: 0.6,
    inverted: true,
  };
  const other: CcMapping = { ...mapped, target: 'strip.pan', min: -1, max: 1, inverted: false };

  it('replaces a mapped target’s source and keeps its range and Inv', () => {
    const source = { device: 'Pads', channel: 2, cc: 74 };
    expect(learnedMappings([mapped, other], 'voice.ops.0.level', source, LEVEL)).toEqual([
      { ...mapped, source },
      other,
    ]);
  });

  it('adds an unmapped target over its full range', () => {
    const source = { device: null, channel: 1, cc: 74 };
    expect(learnedMappings([other], 'voice.ops.0.level', source, LEVEL)).toEqual([
      other,
      { source, target: 'voice.ops.0.level', min: LEVEL.min, max: LEVEL.max, inverted: false },
    ]);
  });
});
