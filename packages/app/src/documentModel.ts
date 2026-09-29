/**
 * The console's document state (#70): always a *normalised*
 * `ArrangementDocument` — every change is deep-merged and re-run through
 * `makeArrangement`, so what the console holds is exactly what an export
 * produces and an import reads back, and the round trip is equality by
 * construction (record §3, §5).
 *
 * The editor is the one caller that passes a library fill (#562): a document
 * written before songs became self-contained names library ids with nothing
 * embedded, and `makeArrangement` resolves those once and embeds them, so the
 * very next export carries every patch the song plays. `filled` is what the
 * Arrangement tab tells the user was filled that way.
 */
import type { ArrangementDocument, MakeArrangementResult } from '@windsor/engine';
import { makeArrangement } from '@windsor/engine';
import { builtInPresets } from './builtInLibrary';
import { reportFinalPartNames } from './partAutoName';

/**
 * Merge for the local copy: objects recurse, arrays and `null` assign
 * wholesale below the keyed sections (`mergeDocument` reads `null` at a slot
 * or a patch id as removal), and — unlike the engine-side merge, which ignores keys the
 * current arrangement lacks — new keys are created, because the result is
 * renormalised immediately after (`mix` may start absent, for instance).
 */
export function deepMerge(current: unknown, partial: unknown): unknown {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isRecord(current) || !isRecord(partial)) return partial;
  if ('kind' in current && 'kind' in partial && current.kind !== partial.kind) return partial;
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(partial)) {
    merged[key] = key in current ? deepMerge(current[key], value) : value;
  }
  return merged;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `deepMerge` over a keyed section (`patches`): `null` at an id removes the entry (#629). */
function mergeKeyed(current: unknown, partial: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(partial)) {
    if (value === null) delete merged[key];
    else merged[key] = key in merged ? deepMerge(merged[key], value) : value;
  }
  return merged;
}

/**
 * The part list merged by slot (#597, #629): a fragment edits the part on its
 * slot wherever it sits in the list, `null` removes that part, and a whole
 * part (its `slot` naming a slot the list lacks) is appended — the same three
 * shapes the engine's `mergeParts` takes, so what was applied live is what
 * lands in the document. A fragment for an absent slot is left alone.
 */
function mergePartList(current: unknown[], partial: Record<string, unknown>): unknown[] {
  const merged: unknown[] = [];
  const held = new Set<string>();
  for (const part of current) {
    const slot = isRecord(part) && typeof part.slot === 'number' ? String(part.slot) : undefined;
    const edit = slot === undefined ? undefined : partial[slot];
    if (slot !== undefined) held.add(slot);
    if (edit === null) continue;
    merged.push(edit === undefined ? part : deepMerge(part, edit));
  }
  for (const [slot, edit] of Object.entries(partial)) {
    if (!held.has(slot) && isRecord(edit) && edit.slot === Number(slot)) merged.push(edit);
  }
  return merged;
}

/** `deepMerge` over a whole document: parts by slot and patches by id, each with `null` as removal. */
export function mergeDocument(current: unknown, partial: unknown): unknown {
  if (!isRecord(current) || !isRecord(partial)) return deepMerge(current, partial);
  const { parts, patches, ...rest } = partial;
  const merged = deepMerge(current, rest) as Record<string, unknown>;
  if (isRecord(patches)) {
    const table = mergeKeyed(current.patches, patches);
    if (Object.keys(table).length > 0) merged.patches = table;
    else delete merged.patches;
  }
  if (isRecord(parts) && Array.isArray(current.parts)) {
    merged.parts = mergePartList(current.parts, parts);
  }
  return merged;
}

export class DocumentModel {
  doc!: ArrangementDocument;
  corrections: string[] = [];
  dangling: string[] = [];
  /** Patch ids this document took from the library rather than carrying (#562). */
  filled: string[] = [];
  usable = true;
  /** The export as it stood when this document was opened, for "changed since opened". */
  private opened = '';
  /** Called after every open, merge and mutate: the song autosave listens here. */
  private readonly listeners = new Set<() => void>();

  constructor(raw: unknown) {
    this.adopt(this.normalise(raw));
    this.opened = this.toJson();
  }

  /** True once any edit has moved the document away from what was opened (#598's New song guard). */
  get changed(): boolean {
    return this.toJson() !== this.opened;
  }

  /** Listen for every change to the document; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The editor's normalisation: the library fills what an older document omits. */
  private normalise(raw: unknown): MakeArrangementResult {
    return makeArrangement(raw, { libraryFill: builtInPresets() });
  }

  /**
   * Open a raw document — the import path. Private `adopt` on purpose: an
   * outside caller normalising for itself is how the file-import path came to
   * bypass the library fill (#562 review pass 1/2, P2).
   *
   * `amend` is an edit the opening itself makes (windsor#103's load-time
   * rename): applied after "opened" is taken, so it counts as a change, while
   * the report stays the one the raw document produced — the
   * import's corrections, dangling names and fills are what the user is told —
   * except that a malformed name's line names what the rename made of it
   * (windsor#114), so the report never contradicts the document.
   */
  open(raw: unknown, amend?: (doc: ArrangementDocument) => unknown): void {
    this.adopt(this.normalise(raw));
    this.opened = this.toJson();
    const partial = amend?.(this.doc);
    if (partial) {
      this.doc = this.normalise(mergeDocument(this.doc, partial)).document;
      this.corrections = reportFinalPartNames(this.corrections, this.doc);
    }
    this.notify();
  }

  private adopt(result: MakeArrangementResult): void {
    this.doc = result.document;
    this.corrections = result.corrections;
    this.dangling = result.dangling;
    this.filled = result.filled;
    this.usable = result.usable;
  }

  /** A live change — a field, a whole part, a removal (#629): merge, renormalise, keep the report. */
  merge(partial: unknown): void {
    this.adopt(this.normalise(mergeDocument(this.doc, partial)));
    this.notify();
  }

  /**
   * A raw document normalised the way `open` would, without adopting it
   * (#629): what a live add or kind change sends the engine is the part the
   * normaliser fills — its strip, velocity and the kind's defaults — so the
   * console never restates one.
   */
  preview(raw: unknown): ArrangementDocument {
    return this.normalise(raw).document;
  }

  /** A whole-document edit — Import's and Restart's path (#629): edit a draft, renormalise. */
  mutate(edit: (draft: Record<string, unknown>) => void): void {
    const draft = JSON.parse(JSON.stringify(this.doc)) as Record<string, unknown>;
    edit(draft);
    this.adopt(this.normalise(draft));
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** The export payload: the normalised document, pretty-printed. */
  toJson(): string {
    return `${JSON.stringify(this.doc, null, 2)}\n`;
  }
}
