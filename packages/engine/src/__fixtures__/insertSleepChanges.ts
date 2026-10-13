/**
 * The control-change sleep tests' run (windsor#802): `insertSleepRun.ts`'s run, with parameters
 * set at the start of chosen blocks. The phaser's and the retro reverb's `*Sleep.test.ts` drive one
 * processor with the sleep and one built with `sleep: false` through the same changes, made while
 * the first is asleep, and compare the two.
 */
import { QUANTUM, type SleepingProcessor, type SleepRun } from './insertSleepRun';

/** Parameter values to set at the start of a block, by block. */
export type BlockChanges = Map<number, Record<string, number>>;

/** `source` (zeros past its end) through `processor` for `blocks` quanta, `changes` applied. */
export function runWithChanges(
  processor: SleepingProcessor,
  params: Record<string, Float32Array>,
  source: Float32Array[],
  blocks: number,
  changes: BlockChanges,
): SleepRun {
  const run: SleepRun = {
    left: new Float32Array(blocks * QUANTUM),
    right: new Float32Array(blocks * QUANTUM),
    asleep: [],
  };
  for (let b = 0; b < blocks; b++) {
    for (const [name, value] of Object.entries(changes.get(b) ?? {})) params[name]![0] = value;
    const input = source.map((channel) => {
      const block = new Float32Array(QUANTUM);
      block.set(channel.subarray(b * QUANTUM, (b + 1) * QUANTUM));
      return block;
    });
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    processor.process([input], [out], params);
    run.left.set(out[0]!, b * QUANTUM);
    run.right.set(out[1]!, b * QUANTUM);
    run.asleep.push(processor.dsp.asleep);
  }
  return run;
}
