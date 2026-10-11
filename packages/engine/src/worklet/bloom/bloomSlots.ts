/**
 * bloom's controls as `Float64Array` slots in descriptor order (worklet
 * rule 3), and the descriptors themselves: the numbers of `BLOOM_BOUNDS`,
 * then Key and Scale as one pitch set, `pitches` (a 12-bit mask, bit p
 * pitch class p, worked out on the main thread; `BLOOM_PITCHES_ALL`, every
 * class, is chromatic and the default), then the Freeze and on/off
 * switches. The
 * processor copies each block's k-rate values in with `readBloomSlots`; the
 * route smooths the continuous ones into `controls` (`BLOOM_SMOOTHED_MASK`).
 *
 * One more descriptor follows the slots' and has no slot: `split`, the
 * wet-path slot's crossing (`BLOOM_SLOT`). It is a-rate, so the processor
 * reads it sample by sample and hands it to the output on its own.
 *
 * Every module reads the controls it owns by these slot names, so a lever
 * is wired by its module alone.
 */
import {
  BLOOM_BOUNDS,
  BLOOM_DEFAULTS,
  BLOOM_PITCHES_ALL,
  BLOOM_SLOT,
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
  'pitches',
  'freeze',
  'enabled',
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
const SLOT_PITCHES = slotOf('pitches');
const SLOT_FREEZE = slotOf('freeze');
const SLOT_ENABLED = slotOf('enabled');

/** The slots the route smooths (one-pole per block): the continuous controls, 1. The rest step, 0. */
const BLOOM_SMOOTHED_MASK = Uint8Array.from(BLOOM_SLOT_NAMES, (name) =>
  ['amount', 'mix', 'swell', 'sustain', 'spread', 'shape', 'bright', 'focus', 'density'].includes(
    name,
  )
    ? 1
    : 0,
);

type BloomParams = Record<string, Float32Array>;

/** The descriptors of the slots, in slot order. */
function bloomSlotDescriptors(): AudioParamDescriptor[] {
  const numbers = Object.entries(BLOOM_BOUNDS).map(([name, [minValue, maxValue]]) => ({
    name,
    minValue,
    maxValue,
    defaultValue: BLOOM_DEFAULTS[name as keyof typeof BLOOM_BOUNDS],
    automationRate: 'k-rate' as const,
  }));
  const pitches: AudioParamDescriptor = {
    name: 'pitches',
    minValue: 0,
    maxValue: BLOOM_PITCHES_ALL,
    defaultValue: BLOOM_PITCHES_ALL,
    automationRate: 'k-rate',
  };
  const switchOf = (name: 'freeze' | 'enabled'): AudioParamDescriptor => ({
    name,
    minValue: 0,
    maxValue: 1,
    defaultValue: Number(BLOOM_DEFAULTS[name]),
    automationRate: 'k-rate',
  });
  return [...numbers, pitches, switchOf('freeze'), switchOf('enabled')];
}

/**
 * Every descriptor: the slots', then `split`. `split` is ramped by the stage,
 * never a field: 0 while the slot is empty, 1 with a child, crossing on the
 * same ramp as the child's fade (`inserts/bloomInsert.ts`), so it is a-rate.
 */
function bloomDescriptors(): AudioParamDescriptor[] {
  return [
    ...bloomSlotDescriptors(),
    {
      name: BLOOM_SLOT.splitParam,
      minValue: 0,
      maxValue: 1,
      defaultValue: 0,
      automationRate: 'a-rate',
    },
  ];
}

/**
 * Each control's value this block into `slots`, in descriptor order. A param
 * the caller lacks keeps its slot; a worklet always has every descriptor.
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
  SLOT_LOW,
  SLOT_MIX,
  SLOT_OCTAVE,
  SLOT_PITCHES,
  SLOT_SHAPE,
  SLOT_SPREAD,
  SLOT_SUSTAIN,
  SLOT_SWELL,
  bloomDescriptors,
  bloomSlotDescriptors,
  readBloomSlots,
};
export type { BloomParams, BloomSlotName };
