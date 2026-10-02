/* eslint-disable no-magic-numbers -- DSP: the operator indices and edge bits are the routing table itself; the tunables are fmConstants.ts (#654) */
/**
 * The eleven operator topologies (#644) and the tables derived from them: the
 * topological evaluation order, and for the fixed-index kernel (#548) each
 * algorithm's modulation edges and carrier bits.
 * Invariant: bit-identity by construction — a modulator list of three must
 * be ascending, and `kernelEdges` refuses one that is not, because a
 * three-term sum's order is the bits. `ALGORITHMS` mirrors `patch.ts`
 * (`patch.test.ts` pins the copy until #656 shares it);
 * `fmProcessorKernel.test.ts` pins the routing rules.
 */

/* ------------------------------------------------------------------ *
 * Algorithms
 *
 * Operators are indexed 0..3 and labelled A B C D, with A at the bottom of the
 * diagram (nearest the output). `mods[i]` lists the operators that modulate i;
 * `carriers` lists the operators summed to the voice output.
 *
 * 0..7 are the classic four-operator topologies (as found on OPM/OPN);
 * 8..10 add the parallel/tapped shapes that make Operator expressive.
 * ------------------------------------------------------------------ */

const A = 0,
  B = 1,
  C = 2,
  D = 3;

/** One topology: which operators modulate each, and which are summed to the output. */
interface Algorithm {
  /** The console's name for the picker. */
  readonly name: string;
  /** The routing in one line, `D>C>B>A`. */
  readonly label: string;
  /** `mods[i]` lists the operators that modulate operator `i`, in summation order. */
  readonly mods: readonly (readonly number[])[];
  /** Operators summed to the voice output, in summation order. */
  readonly carriers: readonly number[];
}

const ALGORITHMS: readonly Algorithm[] = [
  // 0:  D -> C -> B -> A                      full series, the classic FM stack
  { name: 'Series', label: 'D>C>B>A', mods: [[B], [C], [D], []], carriers: [A] },
  // 1:  D,C -> B -> A                         two modulators sum into B
  { name: 'Twin Mod', label: '(D,C)>B>A', mods: [[B], [C, D], [], []], carriers: [A] },
  // 2:  C -> B -> A, D -> A                   series plus a direct modulator
  { name: 'Stack + Mod', label: 'C>B>A, D>A', mods: [[B, D], [C], [], []], carriers: [A] },
  // 3:  D -> C -> A, B -> A                   two-stack and a single into A
  { name: 'Pair into A', label: 'D>C>A, B>A', mods: [[C, B], [], [D], []], carriers: [A] },
  // 4:  D -> C, B -> A                        two independent 2-op stacks
  { name: 'Two Stacks', label: 'D>C | B>A', mods: [[B], [], [D], []], carriers: [A, C] },
  // 5:  D -> C, D -> B, D -> A                one modulator, three carriers
  { name: 'One to Three', label: 'D>(C,B,A)', mods: [[D], [D], [D], []], carriers: [A, B, C] },
  // 6:  D -> C, B and A free                  one stack plus two sines
  { name: 'Stack + Two', label: 'D>C | B | A', mods: [[], [], [D], []], carriers: [A, B, C] },
  // 7:  all four parallel                     additive, no FM at all
  { name: 'Additive', label: 'A|B|C|D', mods: [[], [], [], []], carriers: [A, B, C, D] },
  // 8:  D -> C -> B -> A, B also heard        series with a mid-chain tap
  { name: 'Series + Tap', label: 'D>C>B>A +B', mods: [[B], [C], [D], []], carriers: [A, B] },
  // 9:  D -> C, C -> B, C -> A                shared modulator, split output
  { name: 'Split Branch', label: 'D>C>(B,A)', mods: [[C], [C], [D], []], carriers: [A, B] },
  // 10: D,C,B -> A                            three modulators, one carrier
  { name: 'Triple Mod', label: '(D,C,B)>A', mods: [[B, C, D], [], [], []], carriers: [A] },
];

/** Evaluation order so every modulator is computed before its target. */
function topoOrder(alg: Algorithm): number[] {
  const order: number[] = [];
  const seen = new Uint8Array(4);
  const visit = (i: number): void => {
    if (seen[i]) return;
    seen[i] = 1;
    const m = alg.mods[i]!;
    for (let j = 0; j < m.length; j++) if (m[j] !== i) visit(m[j]!);
    order.push(i);
  };
  for (let i = 0; i < 4; i++) visit(i);
  return order;
}

const ALG_ORDER = ALGORITHMS.map(topoOrder);

/*
 * The fixed-index voice kernel (#548). `Voice.renderKernel` evaluates the
 * operators D, C, B, A with each one's state in locals, and reads routing as
 * edge and carrier flags set once per render call, not as a per-sample walk
 * of `order` and `mods`. It is the generic loop's arithmetic in the generic
 * loop's order, so its output is bit-identical, and an algorithm qualifies
 * only when that holds by construction:
 *   - every modulator has a higher index than its target, so D..A computes
 *     each modulator before it is read, as the topological order does;
 *   - a modulator list of three is ascending (two terms commute exactly), and
 *     so is a carrier list of three or more.
 * The only state operators share is the voice's noise generator, and both
 * loops draw a sample's noise D..A (windsor#389): the generic loop draws its
 * Noise operators' values at the top of each sample, so a voice with any
 * number of Noise operators qualifies on its algorithm alone.
 */
const EDGE_BA = 1,
  EDGE_CA = 2,
  EDGE_DA = 4,
  EDGE_CB = 8,
  EDGE_DB = 16,
  EDGE_DC = 32;
const EDGE_BIT: readonly (readonly number[])[] = [
  [0, EDGE_BA, EDGE_CA, EDGE_DA],
  [0, 0, EDGE_CB, EDGE_DB],
  [0, 0, 0, EDGE_DC],
  [0, 0, 0, 0],
];

function ascending(list: readonly number[]): boolean {
  for (let j = 1; j < list.length; j++) if (list[j]! <= list[j - 1]!) return false;
  return true;
}

/** The algorithm's modulation edges as EDGE_* bits, or -1 when the kernel cannot render it exactly. */
function kernelEdges(alg: Algorithm): number {
  let edges = 0;
  for (let i = 0; i < 4; i++) {
    const m = alg.mods[i]!;
    if (m.length > 2 && !ascending(m)) return -1;
    for (let j = 0; j < m.length; j++) {
      if (m[j]! <= i) return -1;
      edges |= EDGE_BIT[i]![m[j]!]!;
    }
  }
  if (alg.carriers.length > 2 && !ascending(alg.carriers)) return -1;
  return edges;
}

const ALG_EDGES = ALGORITHMS.map(kernelEdges);
const ALG_CARRIER_BITS = ALGORITHMS.map((alg) => alg.carriers.reduce((b, c) => b | (1 << c), 0));

export type { Algorithm };
export {
  A,
  B,
  C,
  D,
  ALGORITHMS,
  ALG_ORDER,
  EDGE_BA,
  EDGE_CA,
  EDGE_DA,
  EDGE_CB,
  EDGE_DB,
  EDGE_DC,
  ALG_EDGES,
  ALG_CARRIER_BITS,
};
