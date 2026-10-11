/**
 * Which of a roll's clip envelopes get one of the part's voice slots
 * (windsor#702, windsor#718): the one admission order, which
 * `ClipEnvelopeTracks.admit` runs at an envelope's first tick, over the
 * tracks it already holds. The app's env ring never runs it: it reads what
 * the tracks hold (`ClipEnvelopeTracks.heldPaths`, windsor#725).
 *
 * In the roll's order, an envelope that plays (`envelopeHeard`) is admitted
 * - when it already holds a slot (a track on its target);
 * - else, sharing its slot, when a song lane playing on the same voice
 *   target holds one, and its target sounds;
 * - else when a slot is free and its target sounds, taking that slot.
 *
 * The slots in use are one per song lane on a voice target, and one per
 * target already held that no lane holds. Whether a target sounds is asked
 * only once a slot is there for it: no macro of the patch maps it, and the
 * patch has a value there (`targetSounds` of the part's handle).
 *
 * Pure, and with the caller's `out` allocates nothing.
 * `clipEnvelopeAdmission.test.ts`, and `clipEnvelopePlayer.test.ts` for
 * the tracks running it.
 */
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import { envelopeHeard } from '../sequencing/rollEnvelopeValue';
import { VOICE_PREFIX } from './automationTargets';

/** What the part's voice slots are asked for, for one roll. */
export interface EnvelopeAdmissionQuery {
  /** The part's song lanes playing now, by target id: each on a voice target holds a slot. */
  lanes: readonly { readonly target: string }[];
  /** The voice paths already holding a slot for an envelope; none for a fresh start. */
  held: readonly { readonly path: string }[];
  /** The roll's envelopes, in its order. */
  envelopes: readonly RollEnvelope[];
  /** The roll's loop. */
  loopTicks: number;
  /** The part's voice slots: `FM_LANES_MAX`. */
  slots: number;
  /** Whether an offset on the voice target at `path` can change the sound. */
  sounds: (path: string) => boolean;
}

/** Whether lane target `target` is the voice target at `path`, without building its id. */
export const isVoiceTargetOf = (target: string, path: string): boolean =>
  target.length === VOICE_PREFIX.length + path.length &&
  target.startsWith(VOICE_PREFIX) &&
  target.endsWith(path);

/** Whether a lane of `lanes` plays on the voice target at `path`. */
function laneOnPath(lanes: EnvelopeAdmissionQuery['lanes'], path: string): boolean {
  for (let i = 0; i < lanes.length; i++) if (isVoiceTargetOf(lanes[i]!.target, path)) return true;
  return false;
}

/** Whether `path` is among `list`'s paths. */
function hasPath(list: readonly { readonly path: string }[], path: string): boolean {
  for (let i = 0; i < list.length; i++) if (list[i]!.path === path) return true;
  return false;
}

/** The slots in use before any new admission: the voice lanes', and each held target no lane holds. */
function slotsInUse(query: EnvelopeAdmissionQuery): number {
  const { lanes, held } = query;
  let used = 0;
  for (let i = 0; i < lanes.length; i++) if (lanes[i]!.target.startsWith(VOICE_PREFIX)) used++;
  for (let i = 0; i < held.length; i++) if (!laneOnPath(lanes, held[i]!.path)) used++;
  return used;
}

/**
 * The voice paths of the envelopes `query` admits, in the roll's order,
 * written into `out` (cleared first).
 */
export function admittedEnvelopes(query: EnvelopeAdmissionQuery, out: string[] = []): string[] {
  out.length = 0;
  const { envelopes, held, lanes, loopTicks, slots, sounds } = query;
  let used = slotsInUse(query);
  for (let i = 0; i < envelopes.length; i++) {
    const envelope = envelopes[i]!;
    const path = envelope.target;
    if (!envelopeHeard(envelope, loopTicks) || out.includes(path)) continue;
    if (hasPath(held, path)) {
      out.push(path);
      continue;
    }
    const shared = laneOnPath(lanes, path);
    if (!shared && used >= slots) continue;
    if (!sounds(path)) continue;
    if (!shared) used++;
    out.push(path);
  }
  return out;
}
