/** Original recipes inspired by Pat's examples, not measured Ableton presets or circuit models. */
import { DEFAULT_ADVANCED_DRIVE, DEFAULT_DRIVE_STAGE } from './advancedDriveSpec';
import type { AdvancedDriveSpec, DriveStageSpec } from './advancedDriveSpec';
import type { InsertPreset } from './insertPresets';
const source = {
  urls: ['https://www.ableton.com/en/live-manual/12/live-audio-effect-reference/#roar'],
  measured: false,
};
const stage = (values: Partial<DriveStageSpec>): DriveStageSpec => ({
  ...DEFAULT_DRIVE_STAGE,
  ...values,
});
const recipe = (
  id: string,
  label: string,
  values: Partial<AdvancedDriveSpec>,
): InsertPreset<AdvancedDriveSpec> => {
  const settings: { -readonly [K in keyof AdvancedDriveSpec]?: AdvancedDriveSpec[K] } = {
    ...DEFAULT_ADVANCED_DRIVE,
    ...values,
  };
  delete settings.mix;
  delete settings.output;
  delete settings.enabled;
  return { id, label, settings, source };
};
export const ADVANCED_DRIVE_PRESETS: readonly InsertPreset<AdvancedDriveSpec>[] = [
  recipe('warmth', 'Soft warmth', { stages: [stage({ amount: 0.3 }), stage({}), stage({})] }),
  recipe('acid', 'Biased acid', {
    route: 'serial',
    blend: 1,
    tone: 3,
    pivot: 410,
    stages: [
      stage({ amount: 0.3, shaper: 'tube' }),
      stage({
        shaper: 'diode',
        amount: 0.76,
        bias: 0.55,
        filtering: true,
        pre: true,
        frequency: 1220,
        resonance: 6,
        level: -3,
        envCutoff: 2,
      }),
      stage({}),
    ],
  }),
  recipe('drums', 'Parallel drum crunch', {
    route: 'parallel',
    blend: 0.45,
    stages: [
      stage({ shaper: 'diode', amount: 0.9, filtering: true, pre: true, frequency: 5370 }),
      stage({ amount: 0.15 }),
      stage({}),
    ],
  }),
  recipe('diodes', 'Serial diode treatment', {
    route: 'serial',
    blend: 1,
    drive: 3,
    stages: [
      stage({ shaper: 'diode', amount: 0.65 }),
      stage({
        shaper: 'diode',
        amount: 0.3,
        bias: 0.68,
        filtering: true,
        pre: true,
        frequency: 14400,
      }),
      stage({}),
    ],
  }),
  recipe('bands', 'Warm bass / torn highs', {
    route: 'multiband',
    stages: [
      stage({ amount: 0.2, shaper: 'tube' }),
      stage({ amount: 0.5, shaper: 'diode' }),
      stage({ amount: 0.7, shaper: 'fold', level: -6 }),
    ],
  }),
  recipe('motion', 'Moving stereo edges', {
    route: 'mid-side',
    sync: true,
    division: '1/1',
    stages: [
      stage({ amount: 0.15 }),
      stage({
        amount: 0.45,
        shaper: 'fold',
        filtering: true,
        frequency: 3500,
        lfoAmount: 0.2,
        lfoCutoff: 1.5,
      }),
      stage({}),
    ],
  }),
];
