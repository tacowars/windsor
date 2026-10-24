/**
 * The pattern bank's Hat group, closed hats (windsor#950); the notation is
 * `drumPatternTables.ts`. The velocities are proposed values for
 * tacowars's listen, not settled ones.
 */
import type { DrumPatternRows } from './drumPatternTables';

export const DRUM_PATTERNS_HAT: readonly DrumPatternRows[] = [
  { id: 'hat-eighths', name: 'Eighths', velocity: 'X.7.X.7.X.7.X.7.' },
  { id: 'hat-offbeats', name: 'Offbeats', velocity: '..9...9...9...9.' },
  {
    id: 'hat-sixteenths',
    name: 'Sixteenths',
    velocity: 'X575X575X575X575',
    half: '..+...+...+...+.',
  },
  { id: 'hat-gallop', name: 'Gallop', velocity: 'X..6X..6X..6X..6' },
  {
    id: 'hat-breaks',
    name: 'Breaks hats',
    velocity: '9.7.9.7.947.947.',
    half: '+...+...+...+...',
  },
  {
    id: 'hat-rolls',
    name: 'Sixteenths with rolls',
    velocity: 'X575X575X575X575',
    half: '..+...+...+...+.',
    ratchet: '.......2...2...3',
  },
];
