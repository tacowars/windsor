/**
 * Spectre's draws and turns (record `2026-10-16-spectre-insert`): a seeded
 * random source, and a table of one cycle of the sine that turns a band's
 * phase and shapes the modulations.
 *
 * - `SpectreRandom` is a 32-bit xorshift: `next()` leaves a draw in 0..1 in
 *   `value`, so no double crosses the call (worklet rule 2). Seeded from
 *   `SPECTRE_DSP.seed`, so a render is reproducible and a golden can pin it.
 * - `SpectreTurns` holds `size` points of one sine cycle; point `i + quarter`
 *   is the cosine at `i`, so a turn by `i` multiplies a band by
 *   (`table[(i + quarter) & mask]`, `table[i & mask]`). Built from
 *   `tapePortableMath.ts`'s sine, the same bits on arm64 and x64.
 *
 * Pinned by `inserts/spectreMods.test.ts`.
 */
import { sine } from '../../inserts/tapePortableMath';

const SPECTRE_TURN_TWO_PI = 6.283185307179586;
const SPECTRE_UINT32 = 4294967296;
const SPECTRE_XOR_A = 13,
  SPECTRE_XOR_B = 17,
  SPECTRE_XOR_C = 5;

class SpectreRandom {
  state: number;
  value: number;

  constructor(seed: number) {
    this.value = NaN;
    this.state = seed | 0 || 1;
    this.value = 0;
  }

  /** The next draw, in 0..1, into `value`. */
  next(): void {
    let s = this.state;
    s ^= s << SPECTRE_XOR_A;
    s ^= s >>> SPECTRE_XOR_B;
    s ^= s << SPECTRE_XOR_C;
    this.state = s;
    this.value = (s >>> 0) / SPECTRE_UINT32;
  }
}

class SpectreTurns {
  readonly size: number;
  readonly mask: number;
  readonly quarter: number;
  readonly table: Float64Array;

  constructor(size: number) {
    this.size = size;
    this.mask = size - 1;
    this.quarter = size >> 2;
    this.table = new Float64Array(size);
    for (let i = 0; i < size; i++) this.table[i] = sine((SPECTRE_TURN_TWO_PI * i) / size);
  }
}

export { SpectreRandom, SpectreTurns };
