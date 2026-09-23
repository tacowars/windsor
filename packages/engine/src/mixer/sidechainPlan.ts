/** Prospective routing validation happens before the player or audio graph mutates. */
import { normaliseInserts } from '../inserts/insertRegistry';
import { FieldNormaliser, isRecord } from '../song/arrangementFields';
import type { DocumentPartial } from '../song/arrangementDocument';
import { disconnectInvalid, invalidSidechains, type SidechainGraph } from './sidechainGraph';
export function planSidechains(
  current: SidechainGraph,
  partial: DocumentPartial,
): { graph: SidechainGraph; error?: string } {
  const graph = new Map(current);
  const n = new FieldNormaliser();
  if (isRecord(partial.parts))
    for (const [key, raw] of Object.entries(partial.parts)) {
      const slot = Number(key);
      if (raw === null) graph.delete(slot);
      else if (isRecord(raw) && (graph.has(slot) || raw.slot === slot)) {
        if (!graph.has(slot)) graph.set(slot, []);
        if (isRecord(raw.strip) && Array.isArray(raw.strip.inserts)) {
          graph.set(slot, normaliseInserts(raw.strip.inserts, `parts.${slot}.strip.inserts`, n));
        }
      }
    }
  if (isRecord(partial.master) && partial.master.inserts !== undefined) {
    graph.set('master', normaliseInserts(partial.master.inserts, 'master.inserts', n));
  }
  const invalid = invalidSidechains(graph);
  const cycle = invalid.find((item) => item.reason === 'post-FX sidechain cycle');
  return cycle
    ? { graph, error: `${cycle.path}: ${cycle.reason}` }
    : { graph: disconnectInvalid(graph, invalid) };
}
