/**
 * The insert ids' shape and the generator behind them (windsor#186,
 * `insertIds.ts`). An id is `INSERT_ID_LENGTH` characters of
 * `INSERT_ID_ALPHABET`, about 2.8 × 10¹² of them, so two fresh ids in one
 * chain are all but never drawn alike, and the generator redraws when they are.
 */

/** The characters an id is drawn from. */
export const INSERT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** How many characters a fresh id has. */
export const INSERT_ID_LENGTH = 8;

/** One past the largest 32-bit unsigned seed. */
export const UINT32_RANGE = 2 ** 32;

/**
 * Mulberry32's constants (Tommy Ettinger's public-domain generator): the
 * increment, the three shifts and the odd multiplier its mix uses.
 */
export const MULBERRY_INCREMENT = 0x6d2b79f5;
export const MULBERRY_SHIFT_A = 15;
export const MULBERRY_SHIFT_B = 7;
export const MULBERRY_SHIFT_C = 14;
export const MULBERRY_ODD = 61;

/** The 32-bit FNV-1a hash's offset basis and prime, for a seed from text. */
export const FNV_OFFSET_BASIS = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;
