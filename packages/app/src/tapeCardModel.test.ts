import { expect, it } from 'vitest';
import { DEFAULT_TAPE, TAPE_PRESETS, applyTapePreset, randomiseTape } from '@windsor/engine';
import { withOversampling } from './tapeCardModel';

it('commits the Oversampling picker as spec.oversampling and ignores a factor the engine lacks (windsor#246)', () => {
  expect(DEFAULT_TAPE.oversampling).toBe(2);
  const four = withOversampling(DEFAULT_TAPE, '4');
  expect(four).toEqual({ ...DEFAULT_TAPE, oversampling: 4 });
  expect(withOversampling(four, '2')).toEqual(DEFAULT_TAPE);
  expect(withOversampling(four, '8')).toBe(four);
});

it('leaves oversampling alone on Randomize and on every preset, which keep their Drive (windsor#246)', () => {
  const four = withOversampling(DEFAULT_TAPE, '4');
  let state = 0.5;
  const random = (): number => (state = (state * 9301 + 49297) % 233280) / 233280;
  for (let roll = 0; roll < 20; roll++) {
    const rolled = randomiseTape(four, random);
    expect(rolled.oversampling).toBe(4);
    expect(rolled.drive).not.toBe(four.drive);
  }
  expect(randomiseTape(DEFAULT_TAPE).oversampling).toBe(2);
  for (const preset of TAPE_PRESETS) {
    expect('oversampling' in preset.settings).toBe(false);
    const applied = applyTapePreset(four, preset.id);
    expect(applied.oversampling).toBe(4);
    expect(applied.drive).toBe(preset.settings.drive);
    expect(applyTapePreset(DEFAULT_TAPE, preset.id).oversampling).toBe(2);
  }
});
