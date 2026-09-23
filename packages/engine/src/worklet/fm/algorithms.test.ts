import { describe, expect, it } from 'vitest';

import {
  A,
  ALG_CARRIER_BITS,
  ALG_DESCENDING,
  ALG_EDGES,
  ALG_ORDER,
  ALGORITHMS,
  B,
  C,
  D,
  EDGE_BA,
  EDGE_CB,
  EDGE_DC,
} from './algorithms';

describe('the algorithm tables', () => {
  it('lists eleven topologies whose modulators are computed before their targets', () => {
    expect(ALGORITHMS).toHaveLength(11);
    ALGORITHMS.forEach((alg, k) => {
      const order = ALG_ORDER[k];
      expect([...order].sort()).toEqual([A, B, C, D]);
      alg.mods.forEach((m, target) => {
        for (const src of m) expect(order.indexOf(src)).toBeLessThan(order.indexOf(target));
      });
    });
  });

  it('gives every shipped algorithm a kernel edge set, with D..A for the series stack', () => {
    expect(ALG_EDGES.every((e) => e >= 0)).toBe(true);
    expect(ALG_EDGES[0]).toBe(EDGE_BA | EDGE_CB | EDGE_DC);
    expect(ALG_DESCENDING[0]).toBe(true);
    expect(ALG_CARRIER_BITS[0]).toBe(1 << A);
    expect(ALG_CARRIER_BITS[7]).toBe(0b1111);
  });
});
