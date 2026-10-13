/**
 * The console's CC router (windsor#783, record `2026-10-13-midi-cc-mapping`):
 * which mappings a controller message drives, whether each picks up, the
 * value it sets, and every event that re-arms pickup. Pure over `CcEngine`,
 * which the MIDI panel implements; nothing here touches Web MIDI or the DOM.
 *
 * - **Routing** (decision 1). A message drives every mapping, across all
 *   parts, whose source matches it: the same CC, a device that is Any or the
 *   message's, a channel that is Any or the message's. The selected part
 *   plays no role.
 * - **Pickup** (decision 7, `ccPickup.ts`) is kept per mapping and per
 *   device name and channel. The target's current value is the CC's base
 *   where the router holds one, else the target's own. A key that applies a
 *   value arms the mapping's other keys, since the target has moved away
 *   from them.
 * - **Last in wins** (decision 2). An on-screen edit of a target clears its
 *   CC base in the engine and re-arms its mapping, and so do a preset change
 *   and Reset performance.
 * - **Re-arming** (decision 7's list). A range edit, `Inv` and a lane let go
 *   re-arm with the hardware position still known, so the hollow marker
 *   stays. Song open, a source edit and an input the console listens to
 *   again forget it: the knob may have moved unheard.
 */
import {
  type CcMapping,
  type CcSource,
  type CcTargetId,
  ccPosition,
  ccValue,
} from '@windsor/engine';

import type { CcEngine, CcMessage, PartCcMapping } from './ccEngine';
import { type CcKeyState, armKey, ccKey, heardOnly, pickupStep } from './ccPickup';
import {
  type CcMarker,
  type CcStatus,
  CC_NOT_IN_PART,
  ccInertReason,
  ccRefusedStatus,
} from './ccStatus';
import type { CcTakeover } from './ccTakeover';

/** One mapping's performance state. */
interface Entry {
  readonly part: number;
  mapping: CcMapping;
  /** Pickup state per device name and channel (`ccKey`). */
  readonly keys: Map<string, CcKeyState>;
  /** The key heard last, whose value the hollow marker shows. */
  lastKey: string | null;
  /** The CC base the engine holds for the target, in its units; undefined when none. */
  held: number | undefined;
  /** The status the engine's refusal of the last value left (`ccRefusedStatus`), or undefined. */
  refused: CcStatus | undefined;
}

const entryKey = (part: number, target: CcTargetId): string => `${part}|${target}`;

/** Whether `source` hears `message` (decision 1). */
export const ccSourceHears = (source: CcSource, message: CcMessage): boolean =>
  source.cc === message.cc &&
  (source.device === null || source.device === message.device) &&
  (source.channel === null || source.channel === message.channel);

const sameSource = (a: CcSource, b: CcSource): boolean =>
  a.cc === b.cc && a.device === b.device && a.channel === b.channel;

const sameRange = (a: CcMapping, b: CcMapping): boolean =>
  a.min === b.min && a.max === b.max && a.inverted === b.inverted;

export class CcRouter {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly engine: CcEngine,
    /** Pickup or Jump; the panel reads and writes the preference (`ccTakeover.ts`). */
    public takeover: CcTakeover = 'pickup',
  ) {}

  /** A song opened: its mappings, nothing held and no hardware position known. */
  songOpened(mappings: readonly PartCcMapping[]): void {
    this.entries = new Map();
    for (const { part, mapping } of mappings)
      this.entries.set(entryKey(part, mapping.target), fresh(part, mapping));
  }

  /**
   * The song's mappings after an edit. A source edit (Learn, device, channel)
   * re-arms and forgets the hardware position; a range or `Inv` edit
   * re-arms. A removed mapping's CC base is cleared, and a new one starts
   * fresh.
   */
  mappingsChanged(mappings: readonly PartCcMapping[]): void {
    const next = new Map<string, Entry>();
    for (const { part, mapping } of mappings) {
      const key = entryKey(part, mapping.target);
      const entry = this.entries.get(key);
      this.entries.delete(key);
      if (!entry) {
        next.set(key, fresh(part, mapping));
        continue;
      }
      if (!sameSource(entry.mapping.source, mapping.source)) forgetKeys(entry);
      else if (!sameRange(entry.mapping, mapping)) armKeys(entry);
      entry.mapping = mapping;
      next.set(key, entry);
    }
    for (const gone of this.entries.values()) this.drop(gone);
    this.entries = next;
  }

  /** One controller message, from whichever input, to every mapping it drives. */
  handle(message: CcMessage): void {
    for (const entry of this.entries.values()) {
      if (ccSourceHears(entry.mapping.source, message)) this.drive(entry, message);
    }
  }

  /** The target was turned on screen: last in wins (decision 2). */
  targetEdited(part: number, target: CcTargetId): void {
    const entry = this.entries.get(entryKey(part, target));
    if (entry) this.release(entry);
  }

  /** The part's preset changed: its targets play the new patch, and its mappings re-arm. */
  presetChanged(part: number): void {
    for (const entry of this.entries.values()) if (entry.part === part) this.release(entry);
  }

  /** Reset performance: every target back to its own value, every mapping re-armed. */
  resetPerformance(): void {
    for (const entry of this.entries.values()) this.release(entry);
  }

  /** A lane on the target was switched off and gave its slot back at the patch's value. */
  laneReleased(part: number, target: CcTargetId): void {
    const entry = this.entries.get(entryKey(part, target));
    if (entry) this.release(entry);
  }

  /**
   * The console listens to an input again: plugged back in, or selected
   * again after the selector left it. Its knobs may have moved unheard, so
   * every mapping forgets that device's keys. The values they set hold.
   */
  inputListened(device: string | null): void {
    for (const entry of this.entries.values()) {
      for (const [key, state] of entry.keys) if (state.device === device) entry.keys.delete(key);
      if (entry.lastKey !== null && !entry.keys.has(entry.lastKey)) entry.lastKey = null;
    }
  }

  /** The row's status for the mapping on `target` of `part`, or undefined for none. */
  status(part: number, target: CcTargetId): CcStatus | undefined {
    const entry = this.entries.get(entryKey(part, target));
    if (!entry) return undefined;
    const now = this.engine.target(part, target);
    if (!now) return { kind: 'inert', reason: CC_NOT_IN_PART };
    const reason = ccInertReason(this.engine.patch(part), target);
    if (reason !== undefined) return { kind: 'inert', reason };
    if (this.engine.automated(part, target)) return { kind: 'automated' };
    if (entry.refused) return entry.refused;
    const position = ccPosition(now.row, entry.mapping, entry.held ?? now.own);
    const picked = [...entry.keys.values()].some((k) => k.picked);
    if (this.takeover === 'pickup' && position !== null && !picked) {
      return { kind: 'waiting', marker: this.marker(entry) };
    }
    return { kind: 'live', value: entry.held ?? now.own, held: entry.held !== undefined };
  }

  /** One message to one mapping it drives. */
  private drive(entry: Entry, message: CcMessage): void {
    const { part, mapping } = entry;
    const key = ccKey(message.device, message.channel);
    const before = entry.keys.get(key);
    entry.lastKey = key;
    const now = this.engine.target(part, mapping.target);
    if (
      !now ||
      ccInertReason(this.engine.patch(part), mapping.target) !== undefined ||
      this.engine.automated(part, mapping.target)
    ) {
      entry.keys.set(key, heardOnly(before, message));
      return;
    }
    const position = ccPosition(now.row, mapping, entry.held ?? now.own);
    const step = pickupStep(before, message, position, this.takeover);
    if (!step.apply) {
      entry.keys.set(key, step.state);
      return;
    }
    const value = ccValue(now.row, mapping, message.value);
    const result = this.engine.apply(part, mapping.target, value);
    entry.refused = ccRefusedStatus(result, mapping.target);
    if (result !== 'applied' && result !== 'noSlot') {
      // Nothing moved: the key does not pick up, so the next value is tried again.
      entry.keys.set(key, heardOnly(before, message));
      return;
    }
    entry.keys.set(key, step.state);
    for (const [other, state] of entry.keys)
      if (other !== key) entry.keys.set(other, armKey(state));
    if (result === 'applied') entry.held = value;
  }

  /** Clear the target's CC base, if it holds one, and re-arm the mapping. */
  private release(entry: Entry): void {
    this.drop(entry);
    armKeys(entry);
  }

  /** Clear the target's CC base in the engine, if it holds one. */
  private drop(entry: Entry): void {
    if (entry.held !== undefined) this.engine.clear(entry.part, entry.mapping.target);
    entry.held = undefined;
    entry.refused = undefined;
  }

  /** The hardware position heard last, where the target's row places it. */
  private marker(entry: Entry): CcMarker | null {
    const state = entry.lastKey === null ? undefined : entry.keys.get(entry.lastKey);
    const now = this.engine.target(entry.part, entry.mapping.target);
    if (!state || !now) return null;
    return { cc: state.heard, value: ccValue(now.row, entry.mapping, state.heard) };
  }
}

const fresh = (part: number, mapping: CcMapping): Entry => ({
  part,
  mapping,
  keys: new Map(),
  lastKey: null,
  held: undefined,
  refused: undefined,
});

/** Re-arm every key, keeping the hardware position each last sent. */
function armKeys(entry: Entry): void {
  for (const [key, state] of entry.keys) entry.keys.set(key, armKey(state));
}

/** Forget every key: the hardware position is no longer known. */
function forgetKeys(entry: Entry): void {
  entry.keys.clear();
  entry.lastKey = null;
}
