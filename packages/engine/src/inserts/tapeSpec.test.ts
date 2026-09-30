import { expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { makeArrangement } from '../song/arrangementDocument';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { TAPE_INSERT } from './tapeInsert';
import { DEFAULT_TAPE } from './tapeSpec';
import { TAPE_TYPES, TAPE_BOUNDS, TAPE_RANDOM as R } from './tapeConstants';
import { randomiseTape } from './tapeRandomise';
import { mulberry32 } from '../sequencing/mulberry32';
it('normalizes absent and malformed fields, including model, integer seed and unknown keys', () => {
  const n = new FieldNormaliser();
  expect(TAPE_INSERT.normalise({ kind: 'tape' }, 'fx', n)).toEqual(DEFAULT_TAPE);
  expect(n.corrections).toEqual([]);
  const fixed = TAPE_INSERT.normalise(
    {
      model: 'unknown-model',
      seed: 2.5,
      drive: Infinity,
      wear: -1,
      bias: 500,
      enabled: 'false',
      unknown: 1,
    },
    'fx',
    n,
  );
  expect(fixed).toMatchObject({
    model: 'studio',
    seed: 3,
    drive: 0,
    wear: 0,
    bias: 100,
    enabled: true,
  });
  expect(n.corrections).toHaveLength(7);
});
it('round trips every tape control on tracks and master, preserving the complete song', () => {
  for (const model of TAPE_TYPES) {
    const effect = {
      ...DEFAULT_TAPE,
      model,
      drive: 19,
      bias: -23,
      wear: 56,
      split: true,
      wow: 17,
      flutter: 29,
      dropouts: 63,
      wowRate: 0.25,
      flutterRate: 12,
      hiss: -41,
      trim: -7,
      mix: 0.62,
      seed: TAPE_BOUNDS.seed[1],
      enabled: false,
    };
    const result = makeArrangement({
      ...FULL_ARRANGEMENT,
      version: 3,
      patches: { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} },
      parts: FULL_ARRANGEMENT.parts.map((part) => ({ ...part, strip: { inserts: [effect] } })),
      master: { inserts: [effect] },
    });
    expect(result.corrections).toEqual([]);
    expect(result.document.parts[0]!.strip!.inserts).toEqual([
      { ...effect, id: expect.any(String) },
    ]);
    expect(result.document.master!.inserts).toEqual([{ ...effect, id: expect.any(String) }]);
    expect(makeArrangement(JSON.parse(JSON.stringify(result.document))).document).toEqual(
      result.document,
    );
  }
});
it('randomizes valid saved values while preserving Trim, Mix, bypass and the original object', () => {
  const random = mulberry32(12);
  const spec = {
    ...DEFAULT_TAPE,
    trim: -11,
    mix: 0.3,
    enabled: false,
    wowRate: TAPE_BOUNDS.wowRate[1],
    flutterRate: TAPE_BOUNDS.flutterRate[0],
  };
  const original = { ...spec };
  for (let i = 0; i < 200; i++) {
    const rolled = randomiseTape(spec, random),
      n = new FieldNormaliser();
    expect(TAPE_INSERT.normalise({ ...rolled }, 'fx', n)).toEqual(rolled);
    expect(n.corrections).toEqual([]);
    expect(rolled).toMatchObject({ trim: -11, mix: 0.3, enabled: false });
    expect(rolled.wowRate).toBeGreaterThanOrEqual(R.wowRateMin);
    expect(rolled.wowRate).toBeLessThanOrEqual(R.wowRateMax);
    expect(rolled.flutterRate).toBeGreaterThanOrEqual(R.flutterRateMin);
    expect(rolled.flutterRate).toBeLessThanOrEqual(R.flutterRateMax);
    expect(spec).toEqual(original);
  }
});
it.each([
  [0, 0.2, 4],
  [0.5, 0.7, 8],
  [1 - Number.EPSILON, 1.2, 12],
])('maps RNG value %s to the intended uniform motion-rate range', (draw, wow, flutter) => {
  const rolled = randomiseTape(DEFAULT_TAPE, () => draw!);
  expect(rolled.wowRate).toBeCloseTo(wow!);
  expect(rolled.flutterRate).toBeCloseTo(flutter!);
  const n = new FieldNormaliser();
  expect(TAPE_INSERT.normalise({ ...rolled }, 'fx', n)).toEqual(rolled);
  expect(n.corrections).toEqual([]);
});
it('replays seeded randomization with separate varying draws for the two motion rates', () => {
  const random = mulberry32(12),
    replay = mulberry32(12);
  const wowRates = new Set<number>(),
    flutterRates = new Set<number>();
  for (let i = 0; i < 20; i++) {
    const rolled = randomiseTape(DEFAULT_TAPE, random);
    expect(rolled).toEqual(randomiseTape(DEFAULT_TAPE, replay));
    wowRates.add(rolled.wowRate);
    flutterRates.add(rolled.flutterRate);
    const wowDraw = (rolled.wowRate - R.wowRateMin) / (R.wowRateMax - R.wowRateMin);
    const flutterDraw =
      (rolled.flutterRate - R.flutterRateMin) / (R.flutterRateMax - R.flutterRateMin);
    expect(wowDraw).not.toBeCloseTo(flutterDraw, 8);
  }
  expect(wowRates.size).toBe(20);
  expect(flutterRates.size).toBe(20);
});
