/**
 * MIDI CC learn (windsor#783, record `2026-10-13-midi-cc-mapping` decisions
 * 10 and 11): one listening session for one target, and the mapping list it
 * commits.
 *
 * - A session takes the first controller, not on `CC_MAPPING_IGNORED`, whose
 *   value moves at least `CC_LEARN_MIN_MOVE` from the first value heard for
 *   that device, channel and CC. A value dump on connect sends each
 *   controller once, and a resting knob jitters by a step, so neither maps.
 * - It records the device name and the channel it heard, never Any. An input
 *   with no name sends a null device, which a mapping reads as Any device:
 *   Web MIDI ids are not stable, so there is nothing else to record.
 * - Cancel leaves nothing: the session ends without a source, and the
 *   caller has nothing to commit.
 * - Committing onto a mapped target replaces that mapping's source and keeps
 *   its range and `Inv`; a new mapping takes the target's full range.
 */
import {
  CC_MAPPING_IGNORED,
  type AutomationTargetRow,
  type CcMapping,
  type CcSource,
  type CcTargetId,
  ccDefaultRange,
} from '@windsor/engine';

import type { CcMessage } from './ccEngine';
import { CC_LEARN_MIN_MOVE } from './midiConstants';

/** One learn session: listening until a CC moves far enough, or until cancelled. */
export class CcLearn {
  /** The first value heard per device, channel and CC. */
  private readonly first = new Map<string, number>();
  private over = false;

  constructor(
    private readonly ignored: ReadonlySet<number> = CC_MAPPING_IGNORED,
    private readonly minMove = CC_LEARN_MIN_MOVE,
  ) {}

  /** Whether the session still listens. */
  get listening(): boolean {
    return !this.over;
  }

  /** One message: the source learned, which ends the session, or null while it listens on. */
  hear(message: CcMessage): CcSource | null {
    if (this.over || this.ignored.has(message.cc)) return null;
    const key = JSON.stringify([message.device, message.channel, message.cc]);
    const first = this.first.get(key);
    if (first === undefined) {
      this.first.set(key, message.value);
      return null;
    }
    if (Math.abs(message.value - first) < this.minMove) return null;
    this.over = true;
    return { device: message.device, channel: message.channel, cc: message.cc };
  }

  /** Stop listening and learn nothing (Cancel, Escape, or the part deleted). */
  cancel(): void {
    this.over = true;
    this.first.clear();
  }
}

/**
 * A part's mappings with `source` learned onto `target`: a mapped target
 * keeps its range and `Inv` and takes the new source (decision 10), and an
 * unmapped one gains a mapping over `row`'s full range (decision 5). A new
 * list, for `ctx.change`.
 */
export function learnedMappings(
  mappings: readonly CcMapping[],
  target: CcTargetId,
  source: CcSource,
  row: AutomationTargetRow,
): CcMapping[] {
  if (mappings.some((m) => m.target === target)) {
    return mappings.map((m) => (m.target === target ? { ...m, source } : m));
  }
  return [...mappings, { source, target, ...ccDefaultRange(row), inverted: false }];
}
