/**
 * The pattern bank's Open hat group (windsor#950); the notation is
 * `drumPatternTables.ts`. The velocities are proposed values for
 * tacowars's listen, not settled ones.
 */
import type { DrumPatternRows } from './drumPatternTables';

export const DRUM_PATTERNS_OPEN_HAT: readonly DrumPatternRows[] = [
  { id: 'open-offbeats', name: 'Open offbeats', velocity: '..9...9...9...9.' },
  { id: 'open-pickups', name: 'Open pickups', velocity: '.......6.......9' },
  { id: 'open-breaks', name: 'Breaks open hat', velocity: '......8.......9.' },
];
