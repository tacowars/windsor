/**
 * The pattern bank's Clap group (windsor#950); the notation is
 * `drumPatternTables.ts`. The velocities are proposed values for
 * tacowars's listen, not settled ones.
 */
import type { DrumPatternRows } from './drumPatternTables';

export const DRUM_PATTERNS_CLAP: readonly DrumPatternRows[] = [
  { id: 'clap-backbeat', name: 'Clap backbeat', velocity: '....X.......X...' },
  { id: 'clap-answer', name: 'Clap with an answer', velocity: '....X.......X.5.' },
  { id: 'clap-double', name: 'Clap with a double', velocity: '....X.......X6..' },
];
