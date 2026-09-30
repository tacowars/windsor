/** The controls' layout: one Float64Array slot per parameter, in descriptor order.
 * The graph reads a control by its slot, never by its name: a double loaded
 * through a string key from a record of seventy-odd keys is a dictionary or
 * megamorphic load, and V8 boxes it (worklet rule 2, windsor#226). Pinned by
 * inserts/advancedDriveAllocation.test.ts.
 */
import { ADVANCED_DRIVE_PARAMETERS } from '../../inserts/advancedDriveParameters';
/** Every control's value, by slot. */
export type DriveControls = Float64Array;
/** Each slot's parameter name. */
export const DRIVE_KEYS: readonly string[] = ADVANCED_DRIVE_PARAMETERS.map((p) => p.name);
export function driveSlot(key: string): number {
  const slot = DRIVE_KEYS.indexOf(key);
  if (slot < 0) throw new Error(`Advanced Drive has no parameter ${key}`);
  return slot;
}
/** The slots of the controls outside the stages. */
export const DRIVE_SLOT = {
  bpm: driveSlot('bpm'),
  route: driveSlot('route'),
  wave: driveSlot('wave'),
  beats: driveSlot('beats'),
  drive: driveSlot('drive'),
  tone: driveSlot('tone'),
  pivot: driveSlot('pivot'),
  output: driveSlot('output'),
  mix: driveSlot('mix'),
  blend: driveSlot('blend'),
  low: driveSlot('low'),
  high: driveSlot('high'),
  rate: driveSlot('rate'),
  attack: driveSlot('attack'),
  release: driveSlot('release'),
  sensitivity: driveSlot('sensitivity'),
  enabled: driveSlot('enabled'),
  compensation: driveSlot('compensation'),
  sync: driveSlot('sync'),
};
/** One stage's slots, as named fields of one literal so every stage shares its shape. */
export function driveStageSlots(stage: number) {
  const at = (key: string): number => driveSlot(`s${stage}_${key}`);
  return {
    amount: at('amount'),
    bias: at('bias'),
    level: at('level'),
    frequency: at('frequency'),
    resonance: at('resonance'),
    peak: at('peak'),
    envAmount: at('envAmount'),
    envBias: at('envBias'),
    envCutoff: at('envCutoff'),
    lfoAmount: at('lfoAmount'),
    lfoBias: at('lfoBias'),
    lfoCutoff: at('lfoCutoff'),
    enabled: at('enabled'),
    shaping: at('shaping'),
    filtering: at('filtering'),
    pre: at('pre'),
    shaper: at('shaper'),
    filter: at('filter'),
  };
}
export type DriveStageSlots = ReturnType<typeof driveStageSlots>;
