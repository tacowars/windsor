/**
 * The pattern bank's Snare group (windsor#950); the notation is
 * `drumPatternTables.ts`. The velocities are proposed values for
 * tacowars's listen, not settled ones.
 */
import type { DrumPatternRows } from './drumPatternTables';

export const DRUM_PATTERNS_SNARE: readonly DrumPatternRows[] = [
  {
    id: 'snare-backbeat',
    name: 'Backbeat',
    velocity: '....X.......X...',
    accent: '....!.......!...',
  },
  {
    id: 'snare-ghosts',
    name: 'Backbeat with ghosts',
    velocity: '...3X..2..3.X.32',
    half: '.......+......++',
    accent: '....!.......!...',
  },
  {
    id: 'snare-breaks',
    name: 'Breaks snare',
    velocity: '....X..4..3.X..5',
    half: '.......+........',
    accent: '....!.......!...',
  },
  {
    id: 'snare-halftime',
    name: 'Half-time snare',
    velocity: '........X.....3.',
    accent: '........!.......',
  },
  {
    // Rising evenly from 0.3 to 1.0 over the bar, rounded to tenths.
    id: 'snare-roll',
    name: 'Snare roll',
    velocity: '33445566778899XX',
    accent: '...............!',
    ratchet: '............2234',
  },
  {
    id: 'snare-fill',
    name: 'Backbeat with a fill',
    velocity: '....X.......X578',
    half: '...............+',
    accent: '....!.......!...',
    ratchet: '..............22',
  },
];
