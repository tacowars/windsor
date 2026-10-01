/**
 * A voice target's automation handle (record
 * `2026-10-01-song-automation-lanes` decisions 2, 7 and 10): a lane on one
 * of the part's FM voice fields, by its patch path (`ops.2.width`).
 *
 * A stub until windsor#346 gives the FM worklet its offset parameters: it
 * finds nothing, so the automation player (windsor#344) leaves every voice
 * lane unplayed. windsor#346 fills this file and never touches the resolver
 * (`system/automationResolver.ts`).
 */
import type { AutomationHandle } from '../automation/automationHandles';
import type { AutomationTargetRow } from '../automation/automationLane';
import type { PartStrip } from '../mixer/channelStrip';

/** Which voice field a lane moves: its patch path. */
export interface VoiceTarget {
  readonly path: string;
}

/** The handle for `target` on `strip`'s part, or undefined when there is none. */
export function voiceAutomationHandle(
  _strip: PartStrip,
  _target: VoiceTarget,
  _row: AutomationTargetRow,
): AutomationHandle | undefined {
  return undefined;
}
