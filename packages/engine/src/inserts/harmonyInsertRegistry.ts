/**
 * The song's key reaches existing and newly created inserts (windsor#717),
 * the way `tempoInsertRegistry.ts` hands them the tempo: every kind's
 * `create` is wrapped, a new stage with `setHarmony` takes the current key at
 * creation and joins the live set, and a change of root or scale is
 * forwarded to every live one. A call that changes neither forwards nothing,
 * so the system calls it after every edit. Until the first call there is no
 * key, and a stage is handed none.
 *
 * The song's chord (windsor#729) goes the same way: `setChord` forwards each
 * set `bloomChordFollower.ts` schedules to every live stage with `setChord`,
 * and a new one is announced through `chordStageAdded`, so the follower hands
 * it the chord under the playhead and the changes already scheduled.
 */
import type { Harmony } from '../harmony/harmonyTimeline';
import { INSERT_KINDS } from './insertRegistry';
import type { InsertRegistry, InsertSpec, InsertStage } from './insertRegistry';

type SongScale = Harmony['scale'];

/** Whether two song scales are the same: one name, or the same offsets in order. */
function sameScale(a: SongScale, b: SongScale): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((offset, i) => offset === b[i]);
}

export function harmonyInsertRegistry(
  source: InsertRegistry = INSERT_KINDS,
  chordStageAdded?: () => void,
): {
  registry: InsertRegistry;
  setHarmony(root: number, scale: SongScale): void;
  /** The song chord's set from `time`; `hold` cancels what was scheduled from `time` first. */
  setChord(mask: number, time: number, hold: boolean): void;
} {
  let key: { root: number; scale: SongScale } | undefined;
  const stages = new Set<InsertStage<InsertSpec>>();
  const registry = Object.fromEntries(
    Object.entries(source).map(([name, kind]) => [
      name,
      {
        ...kind,
        create(context, spec) {
          const stage = kind.create(context, spec);
          if (!stage.setHarmony && !stage.setChord) return stage;
          if (key) stage.setHarmony?.(key.root, key.scale);
          stages.add(stage);
          if (stage.setChord) chordStageAdded?.();
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
    setHarmony(root, scale): void {
      if (key && key.root === root && sameScale(key.scale, scale)) return;
      // A copy, so a later edit to the caller's offsets can't change what is held.
      key = { root, scale: typeof scale === 'string' ? scale : [...scale] };
      for (const stage of stages) stage.setHarmony?.(key.root, key.scale);
    },
    setChord(mask, time, hold): void {
      for (const stage of stages) stage.setChord?.(mask, time, hold);
    },
  };
}
