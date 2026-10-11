/**
 * bloom's controls as `Float64Array` slots in descriptor order (worklet
 * rule 3), and the descriptors themselves: the numbers of `BLOOM_BOUNDS`,
 * then Key and Scale as indices, then the Freeze and on/off switches, then
 * `split` (the wet-path slot's crossing, `BLOOM_SLOT`). The
 * processor copies each block's k-rate values in with `readBloomSlots`; the
 * route smooths the continuous ones into `controls` (`BLOOM_SMOOTHED_MASK`).
 *
 * Every module reads the controls it owns by these slot names, so a lever
 * is wired by its module alone.
 */
import {
  BLOOM_BOUNDS,
  BLOOM_DEFAULTS,
  BLOOM_KEY_DEFAULT,
  BLOOM_KEYS,
  BLOOM_SCALE_DEFAULT,
  BLOOM_SCALES,
} from '../../inserts/bloomConstants';

const BLOOM_SLOT_NAMES = [
  'amount',
  'mix',
  'swell',
  'sustain',
  'spread',
  'shape',
  'bright',
  'focus',
  'density',
  'low',
  'high',
  'octave',
  'key',
  'scale',
  'freeze',
  'enabled',
  'split',
] as const;

type BloomSlotName = (typeof BLOOM_SLOT_NAMES)[number];
const slotOf = (name: BloomSlotName): number => BLOOM_SLOT_NAMES.indexOf(name);

const SLOT_AMOUNT = slotOf('amount');
const SLOT_MIX = slotOf('mix');
const SLOT_SWELL = slotOf('swell');
const SLOT_SUSTAIN = slotOf('sustain');
const SLOT_SPREAD = slotOf('spread');
const SLOT_SHAPE = slotOf('shape');
const SLOT_BRIGHT = slotOf('bright');
const SLOT_FOCUS = slotOf('focus');
const SLOT_DENSITY = slotOf('density');
const SLOT_LOW = slotOf('low');
const SLOT_HIGH = slotOf('high');
const SLOT_OCTAVE = slotOf('octave');
const SLOT_KEY = slotOf('key');
const SLOT_SCALE = slotOf('scale');
const SLOT_FREEZE = slotOf('freeze');
const SLOT_ENABLED = slotOf('enabled');
/** The slot's split, 0 (no child) or 1 (the layer goes through the child), stepped. */
const SLOT_SPLIT = slotOf('split');

/** The slots the route smooths (one-pole per block): the continuous controls, 1. The rest step, 0. */
const BLOOM_SMOOTHED_MASK = Uint8Array.from(BLOOM_SLOT_NAMES, (name) =>
  ['amount', 'mix', 'swell', 'sustain', 'spread', 'shape', 'bright', 'focus', 'density'].includes(
    name,
  )
    ? 1
    : 0,
);

type BloomParams = Record<string, Float32Array>;

function bloomDescriptors(): AudioParamDescriptor[] {
  const numbers = Object.entries(BLOOM_BOUNDS).map(([name, [minValue, maxValue]]) => ({
    name,
    minValue,
    maxValue,
    defaultValue: BLOOM_DEFAULTS[name as keyof typeof BLOOM_BOUNDS],
    automationRate: 'k-rate' as const,
  }));
  const indexOf = (name: string, list: readonly string[], value: string): AudioParamDescriptor => ({
    name,
    minValue: 0,
    maxValue: list.length - 1,
    defaultValue: list.indexOf(value),
    automationRate: 'k-rate',
  });
  const switchOf = (name: 'freeze' | 'enabled'): AudioParamDescriptor => ({
    name,
    minValue: 0,
    maxValue: 1,
    defaultValue: Number(BLOOM_DEFAULTS[name]),
    automationRate: 'k-rate',
  });
  return [
    ...numbers,
    indexOf('key', BLOOM_KEYS, BLOOM_KEY_DEFAULT),
    indexOf('scale', BLOOM_SCALES, BLOOM_SCALE_DEFAULT),
    switchOf('freeze'),
    switchOf('enabled'),
    // Written by the stage, not a field: 0 while the slot is empty, 1 with a child.
    { name: 'split', minValue: 0, maxValue: 1, defaultValue: 0, automationRate: 'k-rate' },
  ];
}

/**
 * Each control's value this block into `slots`, in descriptor order. A param
 * the caller lacks keeps its slot (a harness that predates `split`); a
 * worklet always has every descriptor.
 */
function readBloomSlots(params: BloomParams, slots: Float64Array): void {
  for (let i = 0; i < BLOOM_SLOT_NAMES.length; i++) {
    const values: Float32Array | undefined = params[BLOOM_SLOT_NAMES[i]];
    if (values !== undefined) slots[i] = values[0];
  }
}

export {
  BLOOM_SLOT_NAMES,
  BLOOM_SMOOTHED_MASK,
  SLOT_AMOUNT,
  SLOT_BRIGHT,
  SLOT_DENSITY,
  SLOT_ENABLED,
  SLOT_FOCUS,
  SLOT_FREEZE,
  SLOT_HIGH,
  SLOT_KEY,
  SLOT_LOW,
  SLOT_MIX,
  SLOT_OCTAVE,
  SLOT_SCALE,
  SLOT_SHAPE,
  SLOT_SPLIT,
  SLOT_SPREAD,
  SLOT_SUSTAIN,
  SLOT_SWELL,
  bloomDescriptors,
  readBloomSlots,
};
export type { BloomParams, BloomSlotName };
