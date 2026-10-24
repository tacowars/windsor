/**
 * The pattern bank's Perc group (windsor#950): hand percussion, the tuned
 * toms and a kick bassline, the patterns that are about pitch. The
 * notation is `drumPatternTables.ts`. The velocities are proposed values
 * for tacowars's listen, not settled ones.
 */
import type { DrumPatternRows } from './drumPatternTables';

export const DRUM_PATTERNS_PERC: readonly DrumPatternRows[] = [
  {
    id: 'perc-clave',
    name: 'Son clave 3-2',
    velocity: '9..9..9...9.9...',
    accent: '!...............',
  },
  {
    id: 'perc-tresillo',
    name: 'Tresillo',
    velocity: 'X.....8.....9...',
    half: '......+.........',
  },
  { id: 'perc-offbeat', name: 'Offbeat perc', velocity: '...7..8....7..8.' },
  {
    id: 'tom-roll',
    name: 'Tom roll',
    velocity: '........5567889X',
    half: '.........++..++.',
    accent: '...............!',
    pitch: [0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 5, 5, 3, 3, 0, 0],
  },
  {
    id: 'tom-descent',
    name: 'Tom descent',
    velocity: 'X.8.8.8.8.8.8.8.',
    half: '..+.+.+.+.+.+.+.',
    pitch: [12, 0, 10, 0, 8, 0, 7, 0, 5, 0, 3, 0, 2, 0, 0, 0],
  },
  {
    id: 'kick-bassline',
    name: 'Kick bassline',
    velocity: 'X..7..8.X..7..8.',
    accent: '!.......!.......',
    pitch: [0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 5, 0, 0, 3, 0],
  },
];
