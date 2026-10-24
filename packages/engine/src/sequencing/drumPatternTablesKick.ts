/**
 * The pattern bank's Kick group (windsor#950); the notation is
 * `drumPatternTables.ts`. The velocities are proposed values for
 * tacowars's listen, not settled ones.
 */
import type { DrumPatternRows } from './drumPatternTables';

export const DRUM_PATTERNS_KICK: readonly DrumPatternRows[] = [
  {
    id: 'kick-four',
    name: 'Four on the floor',
    velocity: 'X...X...X...X...',
    accent: '!...............',
  },
  {
    id: 'kick-four-pickup',
    name: 'Four with a pickup',
    velocity: 'X...X...X...X..4',
    half: '...............+',
  },
  {
    id: 'kick-four-double',
    name: 'Four with a double',
    velocity: 'X...X...X.6.X...',
  },
  {
    id: 'kick-electro',
    name: 'Electro kick',
    velocity: 'X......8..9.....',
    accent: '!...............',
  },
  {
    id: 'kick-breaks-a',
    name: 'Breaks kick A',
    velocity: 'X.5....7..9.....',
    half: '..+.......+.....',
  },
  {
    id: 'kick-breaks-b',
    name: 'Breaks kick B',
    velocity: 'X.....7..69....5',
    half: '......+...+.....',
  },
];
