/**
 * Moving an envelope between the patch's six envelope slots (#588).
 *
 * The four operators, the filter and the pitch envelope are all the same
 * `Envelope` type (`audio/patch.ts`), so a shape that works on one operator is
 * the same twelve fields on any other. This is the pure half of the drag —
 * which slots exist, what the status line calls them, and the copy and the
 * swap themselves. tacowars, 2026-09-16, decided both calls the model encodes: a
 * shift-drag swaps rather than copies, and a copy carries loop mode and key
 * scaling with the shape, because a curve without them is not the sound the
 * user heard.
 */
import type { Envelope, Patch } from '../../../packages/client/src/audio/index-for-editor';
import { OP_NAMES } from '../../../packages/client/src/audio/index-for-editor';
import { getPath, setPath } from './patchState';

/** Every envelope in a patch, as a path into it. */
export const ENVELOPE_SLOTS = [
  'ops.0.env',
  'ops.1.env',
  'ops.2.env',
  'ops.3.env',
  'filter.env',
  'pitchEnv',
] as const;

export type EnvelopeSlot = (typeof ENVELOPE_SLOTS)[number];

export const isEnvelopeSlot = (value: string | null | undefined): value is EnvelopeSlot =>
  value != null && (ENVELOPE_SLOTS as readonly string[]).includes(value);

/** The slot an operator index owns; the bays build their canvases from this. */
export function opEnvelopeSlot(index: number): EnvelopeSlot {
  const slot = `ops.${index}.env`;
  if (!isEnvelopeSlot(slot)) throw new Error(`no envelope slot for operator ${index}`);
  return slot;
}

/** What the status line and the canvas titles call a slot. */
export function slotLabel(slot: EnvelopeSlot): string {
  const operator = /^ops\.(\d+)\.env$/.exec(slot);
  if (operator) return OP_NAMES[Number(operator[1])] ?? slot;
  return slot === 'filter.env' ? 'Filter' : 'Pitch';
}

/** The live envelope object at a slot, or null if the patch has no such branch. */
export function readEnvelope(patch: Patch, slot: EnvelopeSlot): Envelope | null {
  const found = getPath(patch, slot);
  return found != null && typeof found === 'object' ? (found as Envelope) : null;
}

/**
 * A structural clone, so the two slots share nothing afterwards: dragging A
 * onto C and then turning C's Attack knob must not move A's curve too.
 */
const cloneEnvelope = (env: Envelope): Envelope => structuredClone(env);

/** Copy `from`'s envelope into `to`. Returns false when nothing changed. */
export function copyEnvelope(patch: Patch, from: EnvelopeSlot, to: EnvelopeSlot): boolean {
  if (from === to) return false;
  const source = readEnvelope(patch, from);
  if (!source || !readEnvelope(patch, to)) return false;
  setPath(patch, to, cloneEnvelope(source));
  return true;
}

/** Exchange the envelopes of two slots. Returns false when nothing changed. */
export function swapEnvelopes(patch: Patch, a: EnvelopeSlot, b: EnvelopeSlot): boolean {
  if (a === b) return false;
  const first = readEnvelope(patch, a);
  const second = readEnvelope(patch, b);
  if (!first || !second) return false;
  setPath(patch, a, cloneEnvelope(second));
  setPath(patch, b, cloneEnvelope(first));
  return true;
}

/** The status line for a completed transfer. */
export function transferMessage(
  kind: 'copy' | 'swap',
  from: EnvelopeSlot,
  to: EnvelopeSlot,
): string {
  return kind === 'copy'
    ? `Copied ${slotLabel(from)}'s envelope to ${slotLabel(to)}`
    : `Swapped ${slotLabel(from)} and ${slotLabel(to)} envelopes`;
}
