/**
 * Euclidean rhythm `E(k, n)`: `k` onsets spread as evenly as possible over `n`
 * steps, by Bjorklund's algorithm (Toussaint, "The Euclidean algorithm
 * generates traditional musical rhythms"). Pure: no state, no randomness.
 *
 * The algorithm pairs the two groups until the remainder is a single group,
 * which yields Toussaint's canonical forms -- `E(3,8) = x..x..x.`,
 * `E(5,8) = x.xx.xx.` -- rather than the rotations a Bresenham-style
 * `floor(i * k / n)` produces.
 */

export type Pattern = readonly boolean[];

function assertPatternArgs(k: number, n: number): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`E(k, n): n must be a positive integer, got ${n}`);
  }
  if (!Number.isInteger(k) || k < 0 || k > n) {
    throw new RangeError(`E(k, n): k must be an integer in [0, ${n}], got ${k}`);
  }
}

/** `E(k, n)` with onset 0 on step 0, optionally rotated right by `rotate` steps. */
export function euclid(k: number, n: number, rotate = 0): Pattern {
  assertPatternArgs(k, n);
  if (k === 0) return new Array<boolean>(n).fill(false);
  if (k === n) return new Array<boolean>(n).fill(true);

  let a: boolean[][] = Array.from({ length: k }, () => [true]);
  let b: boolean[][] = Array.from({ length: n - k }, () => [false]);
  while (b.length > 1) {
    const pairs = Math.min(a.length, b.length);
    const merged: boolean[][] = [];
    for (let i = 0; i < pairs; i++) merged.push([...(a[i] ?? []), ...(b[i] ?? [])]);
    const rest = a.length > b.length ? a.slice(pairs) : b.slice(pairs);
    a = merged;
    b = rest;
  }
  return rotatePattern([...a, ...b].flat(), rotate);
}

/** Rotate right: the onset on step `i` moves to step `(i + rotate) mod n`. */
export function rotatePattern(pattern: Pattern, rotate: number): Pattern {
  const n = pattern.length;
  if (n === 0) return pattern;
  const shift = ((Math.trunc(rotate) % n) + n) % n;
  if (shift === 0) return pattern;
  return pattern.map((_, i) => pattern[(i - shift + n) % n] ?? false);
}

/** `x` for an onset, `.` for a rest -- the notation the tests and the record use. */
export function patternToString(pattern: Pattern): string {
  return pattern.map((on) => (on ? 'x' : '.')).join('');
}

export function patternFromString(text: string): Pattern {
  return [...text].map((c) => c === 'x');
}
