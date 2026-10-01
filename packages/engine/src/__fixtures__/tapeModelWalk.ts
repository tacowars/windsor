/**
 * A closed walk through every ordered pair of tape models once, for the
 * live-switch tests (`inserts/tapeModelSwitch.test.ts`,
 * `inserts/tapeOutputContinuity.test.ts`): Hierholzer's algorithm on the
 * complete directed graph of `count` nodes, from node 0, so each step of the
 * walk is one switch and the walk ends where it began.
 */
export function circuit(count: number): number[] {
  const unused = Array.from({ length: count }, (_, a) =>
    Array.from({ length: count }, (_, b) => b).filter((b) => b !== a),
  );
  const stack = [0];
  const walk: number[] = [];
  while (stack.length > 0) {
    const next = unused[stack[stack.length - 1]!]!.pop();
    if (next === undefined) walk.push(stack.pop()!);
    else stack.push(next);
  }
  return walk.reverse();
}
