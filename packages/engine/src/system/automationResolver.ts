/**
 * Where the automation player finds a lane's target on the live graph
 * (windsor#344, record `2026-10-01-song-automation-lanes` decision 9), keyed
 * by the target's kind:
 *
 * - **strip:** the channel strip's own handles (`PartStrip.automation`), on
 *   the fader, the pan's four gains and the sends;
 * - **insert:** `inserts/insertAutomation.ts` (windsor#345), with the row of
 *   the insert's kind, looked up by the insert's id on the strip;
 * - **voice:** `synth/voiceAutomation.ts` (windsor#346).
 *
 * Undefined for a part the roster lacks, a target that does not parse, an
 * insert the strip does not hold, or a target with no handle yet.
 */
import type { AutomationResolver, ResolvedTarget } from '../automation/automationPlayer';
import type { AutomationHandle } from '../automation/automationHandles';
import type { AutomationTargetRow } from '../automation/automationLane';
import { catalogRow, insertTargetRow, parseTargetId } from '../automation/automationTargets';
import { insertAutomationHandle } from '../inserts/insertAutomation';
import type { PartStrip } from '../mixer/channelStrip';
import { voiceAutomationHandle } from '../synth/voiceAutomation';

const found = (
  handle: AutomationHandle | undefined,
  row: AutomationTargetRow | undefined,
): ResolvedTarget | undefined => (handle && row ? { handle, row } : undefined);

/** A resolver over the music parts' strips, by slot. */
export function automationResolver(
  stripOf: (slot: number) => PartStrip | undefined,
): AutomationResolver {
  return (slot, target) => {
    const strip = stripOf(slot);
    const parsed = parseTargetId(target);
    if (!strip || !parsed) return undefined;
    if (parsed.kind === 'strip') return found(strip.automation(parsed.field), catalogRow(target));
    if (parsed.kind === 'voice') {
      const row = catalogRow(target);
      return row && found(voiceAutomationHandle(strip, parsed, row), row);
    }
    const spec = strip.insertSpecs.find((insert) => insert.id === parsed.insertId);
    const row = spec && insertTargetRow(spec.kind, parsed.field);
    return row && found(insertAutomationHandle(strip, parsed, row), row);
  };
}
