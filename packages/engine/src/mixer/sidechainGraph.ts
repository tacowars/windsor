/** Pure routing rules shared by imports, live edits and the source selector. */
import type { InsertSpec } from '../inserts/insertRegistry';
import type { ArrangementDocument } from '../song/arrangementDocument';
export type InsertTarget = number | 'master';
export type SidechainGraph = ReadonlyMap<InsertTarget, readonly InsertSpec[]>;
export const sidechainSlot = (spec: InsertSpec | undefined): number | null =>
  spec?.kind === 'compressor' && typeof spec.sidechain === 'object' ? spec.sidechain.track : null;
export function documentSidechains(
  doc: Pick<ArrangementDocument, 'parts' | 'master'>,
): SidechainGraph {
  return new Map<InsertTarget, readonly InsertSpec[]>([
    ...doc.parts.map((part): [InsertTarget, readonly InsertSpec[]] => [
      part.slot,
      part.strip.inserts,
    ]),
    ['master', doc.master?.inserts ?? []],
  ]);
}
function reaches(
  graph: SidechainGraph,
  from: number,
  target: number,
  visited = new Set<number>(),
): boolean {
  if (from === target) return true;
  if (visited.has(from)) return false;
  visited.add(from);
  return (graph.get(from) ?? []).some((spec) => {
    const source = sidechainSlot(spec);
    return source !== null && reaches(graph, source, target, visited);
  });
}
export interface InvalidSidechain {
  target: InsertTarget;
  index: number;
  path: string;
  reason: string;
}
export function invalidSidechains(graph: SidechainGraph): InvalidSidechain[] {
  const invalid: InvalidSidechain[] = [];
  for (const [target, specs] of graph)
    specs.forEach((spec, index) => {
      const source = sidechainSlot(spec);
      if (source === null) return;
      const reason = !graph.has(source)
        ? `source track ${source} is missing`
        : target !== 'master' && reaches(graph, source, target)
          ? 'post-FX sidechain cycle'
          : null;
      if (reason)
        invalid.push({
          target,
          index,
          path: `${target === 'master' ? 'master' : `parts.${target}.strip`}.inserts[${index}].sidechain`,
          reason,
        });
    });
  return invalid;
}
/** Explicit external silence, never an internal fallback or a reference a reused slot can revive. */
export function disconnectInvalid(
  graph: SidechainGraph,
  invalid: readonly InvalidSidechain[],
): SidechainGraph {
  const next = new Map(graph);
  for (const { target, index } of invalid) {
    next.set(
      target,
      next
        .get(target)!
        .map((spec, at) =>
          at === index && spec.kind === 'compressor'
            ? { ...spec, sidechain: { track: null } }
            : spec,
        ),
    );
  }
  return next;
}
export function canSidechain(
  doc: Pick<ArrangementDocument, 'parts' | 'master'>,
  target: InsertTarget,
  index: number,
  source: number,
): boolean {
  const graph = new Map(documentSidechains(doc));
  graph.set(
    target,
    (graph.get(target) ?? []).map((spec, at) =>
      at === index && spec.kind === 'compressor' ? { ...spec, sidechain: { track: source } } : spec,
    ),
  );
  return invalidSidechains(graph).length === 0;
}
