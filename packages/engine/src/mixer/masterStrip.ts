/** Song master: summed tracks/returns → inserts → edit fade → output level (#666).
 * It owns its edges and preserves the existing insert updater. The Mixer's
 * master meters read the output stage's report (windsor#194), not this strip.
 * masterStrip.test.ts pins routing, edits and disposal.
 */
import { MS_PER_SECOND } from '../audioConstants';
import { INSERT_KINDS } from '../inserts/insertRegistry';
import type { InsertSpec, InsertStage } from '../inserts/insertRegistry';
import { FieldNormaliser, isRecord } from '../song/arrangementFields';
import type { RouteOptions } from './channelStrip';
import { createInsertChain, createInsertUpdater } from './insertChain';
import { DEFAULT_MASTER, normaliseMaster } from './masterSpec';
import type { MasterSpec } from './masterSpec';
export interface MasterStrip {
  readonly insertSpecs: readonly InsertSpec[];
  readonly input: GainNode;
  readonly output: GainNode;
  readonly inserts: readonly InsertStage<InsertSpec>[];
  readonly spec: MasterSpec;
  apply(raw: unknown): string[];
  dispose(): void;
}
// eslint-disable-next-line max-lines-per-function -- one master graph and the lifetime operations sharing its nodes
export function createMasterStrip(
  context: BaseAudioContext,
  options: RouteOptions = {},
): MasterStrip {
  const input = context.createGain();
  const output = context.createGain();
  const fade = context.createGain();
  fade.connect(output);
  const chain = createInsertChain(context, input, [], options.registry ?? INSERT_KINDS, 'master');
  let tail = chain.tail;
  tail.connect(fade);
  const tap = {
    move(next: AudioNode): void {
      tail.disconnect(fade);
      tail = next;
      tail.connect(fade);
    },
    fadeTo(level: number, seconds: number): void {
      const now = context.currentTime;
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(fade.gain.value, now);
      fade.gain.linearRampToValueAtTime(level, now + seconds);
    },
  };
  const later =
    options.defer ??
    ((run: () => void, seconds: number): void => {
      setTimeout(run, seconds * MS_PER_SECOND);
    });
  const updates = createInsertUpdater(chain, tap, later, options.changed);
  let spec = DEFAULT_MASTER;
  return {
    get insertSpecs(): readonly InsertSpec[] {
      return chain.specs;
    },
    input,
    output,
    get inserts(): readonly InsertStage<InsertSpec>[] {
      return chain.stages;
    },
    get spec(): MasterSpec {
      return spec;
    },
    apply(raw): string[] {
      if (!isRecord(raw)) return ['master'];
      const n = new FieldNormaliser();
      const next = normaliseMaster({ ...spec, ...raw }, n);
      updates.set(next.inserts);
      output.gain.value = next.level;
      spec = next;
      return n.corrections;
    },
    dispose(): void {
      updates.cancel();
      tail.disconnect(fade);
      chain.dispose();
      input.disconnect();
      fade.disconnect();
      output.disconnect();
    },
  };
}
