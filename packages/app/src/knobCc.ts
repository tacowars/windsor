/**
 * What a knob shows of its MIDI CC mapping (windsor#785, record
 * `2026-10-13-midi-cc-mapping` decisions 2, 3, 7 and 12), as values: the
 * mapping's CC for its tag, the CC's value playing for its ring, the hollow
 * marker while it waits for pickup, and whether learn listens for it.
 *
 * A knob names the part and the catalog target it drives through a
 * `KnobCcBinding`; a group's, a return's or the master's knob names no part,
 * so it shows nothing here and its menu refuses learn (`knobCcMenuModel.ts`).
 * What the console's CC state holds is `CcSession`'s, read through
 * `KnobCcState` and never worked out again here: the row's status (waiting,
 * with its marker), the base the engine holds, and the target learn listens
 * for. `ccPanelMount.ts` sets it once.
 *
 * The knob reads this on the console's one frame loop, as its lock and its
 * envelope (`knobLock.ts`'s `followKnob`), into one reused answer.
 */
import type {
  ArrangementDocument,
  CcTargetId,
  DocumentPart,
  DocumentPartial,
  InsertKindName,
} from '@windsor/engine';
import {
  INSERT_AUTOMATION_FIELDS,
  formatTargetId,
  isCcMappableTarget,
  partAt,
  voiceTargetId,
} from '@windsor/engine';

import type { CcStatus } from './ccStatus';
import type { AppCtx } from './context';

/** The document a knob's mapping is read from, and the one way its menu edits it. */
export interface KnobCcScope {
  doc(): ArrangementDocument;
  /** A song edit with its undo step: `ctx.change`. True when it landed. */
  change(partial: DocumentPartial, label: string): boolean;
}

/** The scope over the console's context. */
export const knobCcScope = (ctx: AppCtx): KnobCcScope => ({
  doc: () => ctx.model.doc,
  change: (partial, label) => ctx.change(partial, label).ok,
});

/** Where a knob's value goes: a part's target, or (`part` null) a group's, a return's or the master's. */
export interface KnobCcAt {
  readonly part: number | null;
  readonly target: CcTargetId;
}

/** A knob over a catalog target, as its CC look and its right-click menu see it. */
export interface KnobCcBinding {
  readonly scope: KnobCcScope;
  /** The part and target now (the Parts tab's knobs follow the selected part); null for none. */
  at(): KnobCcAt | null;
  /**
   * The knob's share of a value in the target's units: Coarse's or Fine's
   * half of the ratio (`ratioKnobs.ts`). Absent, the value itself.
   */
  readonly view?: (value: number) => number;
}

/**
 * The catalog target a CC may drive on `field` of an insert of kind `kind`
 * standing under `insertId`, or null: a field the catalog lists no row for
 * on that kind (Bloom's stepped Octave, its Low and High), a switch, or no
 * id. The kind's rows are checked before the id is formed, so asking never
 * throws (`formatTargetId` does on a field the catalog does not hold).
 */
export function insertCcTarget(
  kind: InsertKindName,
  insertId: string,
  field: string,
  fields = INSERT_AUTOMATION_FIELDS,
): CcTargetId | null {
  if (insertId.length === 0) return null;
  const rows: readonly { readonly target: string }[] = fields[kind];
  if (!rows.some((row) => row.target === field)) return null;
  const id = formatTargetId({ kind: 'insert', insertId, field });
  return isCcMappableTarget(id) ? id : null;
}

/** The part's target `target`, as one answer per part: the same object while the part stays. */
export function partTargetAt(part: () => number | null, target: CcTargetId): () => KnobCcAt {
  let last: KnobCcAt = { part: part(), target };
  return () => {
    const now = part();
    if (now !== last.part) last = { part: now, target };
    return last;
  };
}

/**
 * The binding of a knob over `target` that no part owns (a group's, a
 * return's or the master's): its menu shows learn refused (decision 12).
 */
export function noPartCc(ctx: AppCtx, target: CcTargetId): KnobCcBinding {
  const at: KnobCcAt = { part: null, target };
  return { scope: knobCcScope(ctx), at: () => at };
}

/** What the console's CC state answers a knob: `CcSession`'s own reads. */
export interface KnobCcState {
  /** The mapping's row status (`ccStatus.ts`), or undefined for a target with no mapping. */
  status(part: number, target: CcTargetId): CcStatus | undefined;
  /** The CC base the engine holds for the target, in its units, or undefined. */
  held(part: number, target: CcTargetId): number | undefined;
  /** The target learn listens for, or null. */
  readonly learning: { readonly part: number; readonly target: CcTargetId } | null;
}

let current: KnobCcState | null = null;

/** Point the knobs at the console's CC state (`mountCcPanel`), or back at none. */
export function setKnobCcState(next: KnobCcState | null): void {
  current = next;
}

/** The console's CC state, or null before the panel is mounted. */
export const knobCcState = (): KnobCcState | null => current;

/** What a knob shows of its mapping now. */
export interface KnobCc {
  /** The mapping's CC number, or null on a knob with no mapping. */
  cc: number | null;
  /** The CC's value playing, in the knob's units, or null while the target plays its own. */
  held: number | null;
  /** Pickup is armed: the tag is outlined until the hardware crosses the value. */
  waiting: boolean;
  /** Where the hollow marker sits, in the knob's units: null with no position heard yet. */
  marker: number | null;
  /** Learn listens for this knob's target: the knob is lit. */
  learning: boolean;
}

/** A fresh answer for `knobCcAt` to fill: one per knob, reused frame after frame. */
export const emptyKnobCc = (): KnobCc => ({
  cc: null,
  held: null,
  waiting: false,
  marker: null,
  learning: false,
});

const same = (value: number): number => value;

/**
 * The CC look of the knob at `at`, on `part` (the document's part at
 * `at.part`), written into `out`: null when the knob has no mapping and
 * learn does not listen for it. `view` turns a value in the target's units
 * into the knob's.
 */
export function knobCcAt(
  part: DocumentPart | undefined,
  at: KnobCcAt,
  state: KnobCcState | null,
  out: KnobCc = emptyKnobCc(),
  view: (value: number) => number = same,
): KnobCc | null {
  const slot = at.part;
  if (slot === null || !part) return null;
  const learning = state?.learning;
  out.learning = learning?.part === slot && learning.target === at.target;
  const mapping = part.ccMappings?.find((m) => m.target === at.target);
  if (!mapping && !out.learning) return null;
  out.cc = mapping ? mapping.source.cc : null;
  const status = mapping ? state?.status(slot, at.target) : undefined;
  const held = mapping ? state?.held(slot, at.target) : undefined;
  out.held = held === undefined ? null : view(held);
  out.waiting = status?.kind === 'waiting';
  const marker = status?.kind === 'waiting' ? status.marker : null;
  out.marker = marker ? view(marker.value) : null;
  return out;
}

/** The CC look `binding`'s knob shows now, read from the console's state into `out`. */
export function readKnobCc(binding: KnobCcBinding, out: KnobCc): KnobCc | null {
  const at = binding.at();
  if (!at || at.part === null) return null;
  const part = partAt(binding.scope.doc(), at.part);
  return knobCcAt(part, at, current, out, binding.view);
}

/** Whether a reading moved from the last one, `last` then taking it (copied: the reading is reused). */
export function knobCcMoved(last: KnobCc & { shown: boolean }, now: KnobCc | null): boolean {
  const shown = now !== null;
  if (
    shown === last.shown &&
    (!now ||
      (now.cc === last.cc &&
        now.held === last.held &&
        now.waiting === last.waiting &&
        now.marker === last.marker &&
        now.learning === last.learning))
  ) {
    return false;
  }
  Object.assign(last, now ?? emptyKnobCc(), { shown });
  return true;
}

const VOICE_TARGETS = new Map<string, CcTargetId>();

/**
 * The CC base the engine holds on the voice target at patch path `path` of
 * part `part`, or undefined: the centre a clip envelope rides on
 * (`knobEnvelope.ts`). Each path's target id is made once.
 */
export function heldOnPath(part: number, path: string): number | undefined {
  if (!current) return undefined;
  let target = VOICE_TARGETS.get(path);
  if (target === undefined) VOICE_TARGETS.set(path, (target = voiceTargetId(path)));
  return current.held(part, target);
}
