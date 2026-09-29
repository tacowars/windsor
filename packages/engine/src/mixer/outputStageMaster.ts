/**
 * A song master partial applied live (windsor#93): to the song master's
 * strip, then its `output` to the engine's output stage, so the stage always
 * plays what the strip's spec says. A partial `output` is merged over the
 * settings in force (`mergeMasterPartial`), so changing the mode keeps the
 * ceiling. `system/audioSystemOutputStage.test.ts` pins it through
 * `AudioSystem`.
 */
import { masterOutput, mergeMasterPartial } from './masterSpec';
import type { MasterStrip } from './masterStrip';
import type { OutputStage } from './outputStage';

/** Apply `partial` (absent: nothing); the return is what the strip corrected or ignored. */
export function applyMasterLive(
  strip: MasterStrip,
  stage: OutputStage | null,
  partial: unknown,
): string[] {
  if (partial === undefined) return [];
  const ignored = strip.apply(mergeMasterPartial(strip.spec, partial));
  stage?.set(masterOutput(strip.spec));
  return ignored;
}
