/**
 * Where the automation player finds a lane's target on the live graph
 * (windsor#344, record `2026-10-01-song-automation-lanes` decision 9), keyed
 * by the lane's owner (windsor#614) and the target's kind:
 *
 * - **strip:** a part's channel strip's own handles (`PartStrip.automation`),
 *   on the fader, the pan's four gains and the sends; a group bus's
 *   (`GroupBus.automation`), on its fader and its pan only;
 * - **insert:** `inserts/insertAutomation.ts` (windsor#345), with the row of
 *   the insert's kind, looked up by the insert's id on the strip or the bus;
 * - **voice:** `synth/voiceAutomation.ts` (windsor#346), a part's only.
 *
 * Undefined for an owner the song lacks, a target that does not parse or
 * that the owner does not have, an insert it does not hold, or a target
 * with no handle yet.
 */
import type { AutomationResolver, ResolvedTarget } from '../automation/automationPlayer';
import type { AutomationHandle } from '../automation/automationHandles';
import type { AutomationTargetRow, ParsedTarget } from '../automation/automationLane';
import { isGroupOwner } from '../automation/automationOwner';
import {
  catalogRow,
  insertTargetRow,
  isGroupTarget,
  parseTargetId,
} from '../automation/automationTargets';
import type { InsertHost } from '../inserts/insertAutomation';
import { insertAutomationHandle } from '../inserts/insertAutomation';
import type { PartStrip } from '../mixer/channelStrip';
import type { GroupBus } from '../mixer/groupBus';
import { voiceAutomationHandle } from '../synth/voiceAutomation';

const found = (
  handle: AutomationHandle | undefined,
  row: AutomationTargetRow | undefined,
): ResolvedTarget | undefined => (handle && row ? { handle, row } : undefined);

/** An insert lane on `host`'s chain: the row of the insert's kind, and its stage's handle. */
function insertTarget(
  host: InsertHost,
  parsed: Extract<ParsedTarget, { kind: 'insert' }>,
): ResolvedTarget | undefined {
  const spec = host.insertSpecs.find((insert) => insert.id === parsed.insertId);
  const row = spec && insertTargetRow(spec.kind, parsed.field);
  return row && found(insertAutomationHandle(host, parsed, row), row);
}

/** A part's lane: its strip's handles, its inserts' and its voice's. */
function partTarget(strip: PartStrip, target: string): ResolvedTarget | undefined {
  const parsed = parseTargetId(target);
  // A sequencer lane (windsor#488) is the region gate's: it has no handle here.
  if (!parsed || parsed.kind === 'seq') return undefined;
  if (parsed.kind === 'strip') return found(strip.automation(parsed.field), catalogRow(target));
  if (parsed.kind === 'voice') {
    const row = catalogRow(target);
    return row && found(voiceAutomationHandle(strip, parsed, row), row);
  }
  return insertTarget(strip, parsed);
}

/** A group's lane: its bus's level and pan, and its inserts'. */
function groupTarget(bus: GroupBus, target: string): ResolvedTarget | undefined {
  const parsed = parseTargetId(target);
  if (!parsed || !isGroupTarget(target)) return undefined;
  if (parsed.kind === 'insert') return insertTarget(bus, parsed);
  return parsed.kind === 'strip'
    ? found(bus.automation(parsed.field), catalogRow(target))
    : undefined;
}

/** A resolver over the music parts' strips, by slot, and the group buses, by id. */
export function automationResolver(
  stripOf: (slot: number) => PartStrip | undefined,
  groupOf: (id: number) => GroupBus | undefined = () => undefined,
): AutomationResolver {
  return (owner, target) => {
    if (isGroupOwner(owner)) {
      const bus = groupOf(owner.group);
      return bus && groupTarget(bus, target);
    }
    const strip = stripOf(owner.part);
    return strip && partTarget(strip, target);
  };
}
