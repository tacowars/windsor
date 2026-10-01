import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAPE,
  TAPE_CORE_BOUNDS,
  TAPE_PRESETS,
  applyTapePreset,
  randomiseTape,
  tapeCoreOf,
  type TapeSpec,
} from '@windsor/engine';
import {
  coreKnobValue,
  isCustomCore,
  modelCoreValue,
  withCoreKnob,
  withModel,
  withModelCore,
  withOversampling,
} from './tapeCardModel';

describe('the Advanced section (windsor#291 decisions 2 and 3)', () => {
  const ferric: TapeSpec = { ...DEFAULT_TAPE, model: 'ferric' };
  const row = tapeCoreOf(ferric);

  it("shows the model's row until a knob turns, then writes all three into `core`", () => {
    expect(isCustomCore(ferric)).toBe(false);
    expect(coreKnobValue(ferric, 'width')).toBe(row.width);
    const bent = withCoreKnob(ferric, 'drive', 0.9);
    expect(bent.core).toEqual({ ...row, drive: 0.9 });
    expect(isCustomCore(bent)).toBe(true);
    expect(coreKnobValue(bent, 'drive')).toBe(0.9);
    expect(modelCoreValue(bent, 'drive')).toBe(row.drive);
  });

  it('keeps `core` through a Tape type change and Randomize', () => {
    const bent = withCoreKnob(ferric, 'saturation', 0.1);
    const vhs = withModel(bent, 'vhs');
    expect(vhs.model).toBe('vhs');
    expect(vhs.core).toBe(bent.core);
    expect(isCustomCore(vhs)).toBe(true);
    expect(withModel(bent, 'reel-to-reel')).toBe(bent);
    let state = 0.5;
    const random = (): number => (state = (state * 9301 + 49297) % 233280) / 233280;
    for (let roll = 0; roll < 10; roll++) expect(randomiseTape(bent, random).core).toBe(bent.core);
  });

  it('clears `core` with Use model and with every starting point', () => {
    const bent = withCoreKnob(ferric, 'width', TAPE_CORE_BOUNDS.width[0]);
    expect(withModelCore(bent)).toEqual(ferric);
    expect(isCustomCore(withModelCore(bent))).toBe(false);
    for (const preset of TAPE_PRESETS)
      expect(isCustomCore(applyTapePreset(bent, preset.id))).toBe(false);
  });
});

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
