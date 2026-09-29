/**
 * The arp step grid's tunables (windsor#127, epic windsor#126): the fixed
 * number of cells every arp carries and the styles whose cycle bounces. The
 * logic is `arpSteps.ts`, which takes these as parameters defaulting to them.
 */
import type { ArpStyle } from './arpSequencer';

/**
 * The cells an arp stores, always exactly this many. The longest cycle is a
 * bounce over 4-note chords × 4 octaves, 2 × 16 − 2 = 30 cells, so every
 * cycle fits (`arpSteps.test.ts` derives it from the chord and octave limits).
 */
export const ARP_STEPS_MAX = 32;

/**
 * The styles that walk up and back without repeating the ends: over `L > 2`
 * notes their cycle is `2L − 2` cells. Every other style's cycle is `L`.
 */
export const ARP_BOUNCE_STYLES: readonly ArpStyle[] = ['upDown', 'downUp', 'conDiverge'];

/**
 * The salt that sets the skip-chance stream apart from the walk's
 * (windsor#129, `arpCellPlay.ts`): the walk's stream seed is XORed with it
 * and put through one mulberry32 draw, and that draw seeds the skip stream.
 */
export const ARP_SKIP_STREAM_SALT = 0x5bd1e995;

/** The span of a 32-bit seed: a draw in [0, 1) times this is a whole 32-bit seed. */
export const UINT32_SPAN = 2 ** 32;
