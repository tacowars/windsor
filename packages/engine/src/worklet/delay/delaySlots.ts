/** The delay's controls' layout: one Float64Array slot per control, in `DELAY_KEYS` order.
 * The render reads a control by its slot, never by its name: a record of
 * controls built by spreading the defaults took its fields' first values as
 * small integers and a boolean, and every later double write generalised it
 * (worklet rule 7, windsor#232). A slot holds a double from the start. The
 * slots up to `enabled` are the processor's parameters of the same name, in
 * its descriptors' order (`DELAY_PARAM_KEYS`); `ping` and `mid` are the
 * mode's two crossfades. Pinned by inserts/delayAllocation.test.ts.
 */
/** Every control's value, by slot. */
export type DelayControls = Float64Array;
/** The processor's parameters, in descriptor order: the numbers, then the choices and switches. */
export const DELAY_PARAM_KEYS = [
  'leftMs',
  'rightMs',
  'feedback',
  'cross',
  'lowCut',
  'cutoff',
  'resonance',
  'width',
  'drive',
  'damping',
  'dampingHz',
  'modRate',
  'wow',
  'sweep',
  'mix',
  'outputDb',
  'mode',
  'filter',
  'character',
  'wave',
  'sustain',
  'enabled',
] as const;
/** Each slot's name. */
export const DELAY_KEYS = [...DELAY_PARAM_KEYS, 'ping', 'mid'] as const;
export type DelayKey = (typeof DELAY_KEYS)[number];
const slot = (key: DelayKey): number => DELAY_KEYS.indexOf(key);
/** Each control's slot, by name. */
export const DELAY_SLOT = Object.fromEntries(DELAY_KEYS.map((key) => [key, slot(key)])) as Record<
  DelayKey,
  number
>;
