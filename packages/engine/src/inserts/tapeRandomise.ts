/** CC0 REELS randomizer weighting; Windsor also rolls the persisted noise seed. Trim/mix/bypass stay put. */
import { TAPE_BOUNDS, TAPE_RANDOM as R, TAPE_TYPES } from './tapeConstants';
import type { TapeSpec } from './tapeSpec';
export function randomiseTape(spec: TapeSpec, random: () => number = Math.random): TapeSpec {
  return {
    ...spec,
    model: TAPE_TYPES[Math.floor(random() * TAPE_TYPES.length)] ?? spec.model,
    drive: R.driveMax * random() ** R.drivePower,
    bias: TAPE_BOUNDS.bias[0] + (TAPE_BOUNDS.bias[1] - TAPE_BOUNDS.bias[0]) * random(),
    wear: R.wearMax * random() ** R.wearPower,
    hiss: R.hissMin + (R.hissMax - R.hissMin) * random() ** R.hissPower,
    seed: Math.floor(random() * (TAPE_BOUNDS.seed[1] + 1)),
  };
}
