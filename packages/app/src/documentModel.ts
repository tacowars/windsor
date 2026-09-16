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
import type {
  ArrangementDocument,
  MakeArrangementResult,
} from '../../../packages/client/src/audio/index-for-editor';
import { PRESETS, makeArrangement } from '../../../packages/client/src/audio/index-for-editor';

/**
 * Merge for the local copy: objects recurse, arrays and `null` assign
 * wholesale, and — unlike the engine-side merge, which ignores keys the
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

/**
 * `deepMerge` over a whole document (#597): the part list is merged by slot —
 * `{ parts: { 2: { velocity: 0.5 } } }` reaches the part on slot 2 wherever it
 * sits in the list — and a slot the list does not hold is left alone rather
 * than invented, because adding a part is a structural edit.
 */
export function mergeDocument(current: unknown, partial: unknown): unknown {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isRecord(current) || !isRecord(partial)) return deepMerge(current, partial);
  const { parts, ...rest } = partial;
  const merged = deepMerge(current, rest) as Record<string, unknown>;
  if (!isRecord(parts) || !Array.isArray(current.parts)) return merged;
  merged.parts = (current.parts as unknown[]).map((part) => {
    const slot = isRecord(part) ? part.slot : undefined;
    const edit = typeof slot === 'number' ? parts[String(slot)] : undefined;
    return edit === undefined ? part : deepMerge(part, edit);
  });
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

  constructor(raw: unknown) {
    this.adopt(this.normalise(raw));
    this.opened = this.toJson();
  }

  /** True once any edit has moved the document away from what was opened (#598's New song guard). */
  get changed(): boolean {
    return this.toJson() !== this.opened;
  }

  /** The editor's normalisation: the library fills what an older document omits. */
  private normalise(raw: unknown): MakeArrangementResult {
    return makeArrangement(raw, { libraryFill: PRESETS });
  }

  /**
   * Open a raw document — the import path. Private `adopt` on purpose: an
   * outside caller normalising for itself is how the file-import path came to
   * bypass the library fill (#562 review pass 1/2, P2).
   */
  open(raw: unknown): void {
    this.adopt(this.normalise(raw));
    this.opened = this.toJson();
  }

  private adopt(result: MakeArrangementResult): void {
    this.doc = result.document;
    this.corrections = result.corrections;
    this.dangling = result.dangling;
    this.filled = result.filled;
    this.usable = result.usable;
  }

  /** A field-level change: merge, renormalise, keep the report. */
  merge(partial: unknown): void {
    this.adopt(this.normalise(mergeDocument(this.doc, partial)));
  }

  /** A structural change (slot added or removed): edit a draft, renormalise. */
  mutate(edit: (draft: Record<string, unknown>) => void): void {
    const draft = JSON.parse(JSON.stringify(this.doc)) as Record<string, unknown>;
    edit(draft);
    this.adopt(this.normalise(draft));
  }

  /** The export payload: the normalised document, pretty-printed. */
  toJson(): string {
    return `${JSON.stringify(this.doc, null, 2)}\n`;
  }
}
