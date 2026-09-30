/** The delay's controls' layout: one Float64Array slot per control, in `DELAY_KEYS` order.
 * The render reads a control by its slot, never by its name: a record of
 * controls built by spreading the defaults took its fields' first values as
 * small integers and a boolean, and every later double write generalised it
 * (worklet rule 7, windsor#232). A slot holds a double from the start. The
 * first nine slots are the processor's parameters of the same name; `ping`
 * and `mid` are the mode's two crossfades. Pinned by
 * inserts/delayAllocation.test.ts.
 */
/** Every control's value, by slot. */
export type DelayControls = Float64Array;
/** Each slot's name. */
export const DELAY_KEYS = [
  'leftMs',
  'rightMs',
  'feedback',
  'highpass',
  'lowpass',
  'drive',
  'mix',
  'outputDb',
  'enabled',
  'ping',
  'mid',
] as const;
export type DelayKey = (typeof DELAY_KEYS)[number];
const slot = (key: DelayKey): number => DELAY_KEYS.indexOf(key);
/** Each control's slot, by name. */
export const DELAY_SLOT = {
  leftMs: slot('leftMs'),
  rightMs: slot('rightMs'),
  feedback: slot('feedback'),
  highpass: slot('highpass'),
  lowpass: slot('lowpass'),
  drive: slot('drive'),
  mix: slot('mix'),
  outputDb: slot('outputDb'),
  enabled: slot('enabled'),
  ping: slot('ping'),
  mid: slot('mid'),
} satisfies Record<DelayKey, number>;
