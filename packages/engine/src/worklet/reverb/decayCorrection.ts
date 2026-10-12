/**
 * The measured correction from an RT60 asked of the tank to the RT60 its gain
 * points are cut from (windsor#748): the factor in `reverbDecayTables.ts` at
 * the block's Size and that RT60, read bilinearly between the table's cells
 * and held at its edges. The broadband gains (`tankGains.ts`) ask it for
 * Decay, and the low band (`plateLowBand.ts`) asks it for its own target,
 * Decay × `lowDecay`, never reusing the broadband factor: the table's factor
 * climbs with the RT60 asked, steeply at the smallest Sizes, so the band's
 * target needs its own cell (fix round 2 of PR windsor#750).
 *
 * Runs once a block per caller, never per sample. Invariant: no double
 * crosses a call (worklet rule 2): the RT60 goes in and comes back in
 * `plate._rt60`, and `locate` reads its point from `plate._cellAt` and leaves
 * the cell in `plate._cell` and `plate._cellAt`. Pinned by
 * `mixer/reverbDecay.test.ts` (the broadband T30) and
 * `mixer/reverbLowBand.test.ts` (each band's T30).
 */

import { DECAY_TABLE_DECAYS, DECAY_TABLE_FACTORS, DECAY_TABLE_SIZES } from './reverbDecayTables';
import type { DattorroReverb } from './reverbProcessor';

/** Where `plate._cellAt` sits in the ascending `grid`: the cell's lower index into `_cell`, its fraction into `_cellAt`. */
function locate(plate: DattorroReverb, grid: number[]): void {
  const at = plate._cellAt;
  let i = 0;
  while (i < grid.length - 2 && at > grid[i + 1]) i++;
  plate._cell = i;
  plate._cellAt = Math.min(1, Math.max(0, (at - grid[i]) / (grid[i + 1] - grid[i])));
}

/** `plate._rt60`, the RT60 asked, becomes the RT60 the gains are cut from, at the block's Size. */
function correctDecay(plate: DattorroReverb): void {
  const asked = plate._rt60;
  const factors = DECAY_TABLE_FACTORS;
  const row = DECAY_TABLE_DECAYS.length;
  plate._cellAt = plate._size;
  locate(plate, DECAY_TABLE_SIZES);
  const lower = plate._cell * row;
  const u = plate._cellAt;
  plate._cellAt = asked;
  locate(plate, DECAY_TABLE_DECAYS);
  const j = plate._cell;
  const v = plate._cellAt;
  const near = factors[lower + j] + (factors[lower + j + 1] - factors[lower + j]) * v;
  const far =
    factors[lower + row + j] + (factors[lower + row + j + 1] - factors[lower + row + j]) * v;
  plate._rt60 = asked * (near + (far - near) * u);
}

export { correctDecay };
