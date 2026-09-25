/** Song tempo reaches existing and newly created inserts, including deferred chain edits. */
import { INSERT_KINDS } from './insertRegistry';
import type { InsertRegistry, InsertSpec, InsertStage } from './insertRegistry';

export function tempoInsertRegistry(
  initialBpm: number,
  source: InsertRegistry = INSERT_KINDS,
): {
  registry: InsertRegistry;
  setTempo(bpm: number): void;
} {
  let bpm = initialBpm;
  const stages = new Set<InsertStage<InsertSpec>>();
  const registry = Object.fromEntries(
    Object.entries(source).map(([name, kind]) => [
      name,
      {
        ...kind,
        create(context, spec) {
          const stage = kind.create(context, spec);
          stage.setTempo?.(bpm);
          if (stage.setTempo) stages.add(stage);
          return {
            ...stage,
            dispose(): void {
              stages.delete(stage);
              stage.dispose();
            },
          };
        },
      } satisfies InsertRegistry[string],
    ]),
  );
  return {
    registry,
    setTempo(next): void {
      bpm = next;
      for (const stage of stages) stage.setTempo!(bpm);
    },
  };
}
