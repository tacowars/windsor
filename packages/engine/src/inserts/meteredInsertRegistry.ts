/** Attach worklet inserts to the engine's load meter for exactly their lifetime. */
import { AUDIO_LOAD_REPORT_SECONDS } from '../audioConstants';
import { meterNode } from '../audioLoad';
import type { AudioLoadMeter } from '../audioLoad';
import { INSERT_KINDS } from './insertRegistry';
import type { InsertRegistry } from './insertRegistry';

export function meteredInsertRegistry(
  meter: AudioLoadMeter,
  registry: InsertRegistry = INSERT_KINDS,
): InsertRegistry {
  let serial = 0;
  return Object.fromEntries(
    Object.entries(registry).map(([name, kind]) => [
      name,
      {
        ...kind,
        create(context, spec) {
          const stage = kind.create(context, spec);
          if (!stage.processor) return stage;
          const id = `insert:${++serial}`;
          meterNode(meter, id, stage.processor, context.sampleRate, AUDIO_LOAD_REPORT_SECONDS);
          return {
            ...stage,
            dispose(): void {
              meter.detach(id);
              stage.dispose();
            },
          };
        },
      } satisfies InsertRegistry[string],
    ]),
  );
}
