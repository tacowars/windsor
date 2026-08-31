/**
 * The console's document state (#70): always a *normalised*
 * `ArrangementDocument` — every change is deep-merged and re-run through
 * `makeArrangement`, so what the console holds is exactly what an export
 * produces and an import reads back, and the round trip is equality by
 * construction (record §3, §5).
 */
import type {
  ArrangementDocument,
  MakeArrangementResult,
} from '../../../packages/client/src/audio/index-for-editor';
import { makeArrangement } from '../../../packages/client/src/audio/index-for-editor';

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

export class DocumentModel {
  doc!: ArrangementDocument;
  corrections: string[] = [];
  dangling: string[] = [];
  usable = true;

  constructor(raw: unknown) {
    this.adopt(makeArrangement(raw));
  }

  /** Take a normalisation result wholesale — the import path. */
  adopt(result: MakeArrangementResult): void {
    this.doc = result.document;
    this.corrections = result.corrections;
    this.dangling = result.dangling;
    this.usable = result.usable;
  }

  /** A field-level change: merge, renormalise, keep the report. */
  merge(partial: unknown): void {
    this.adopt(makeArrangement(deepMerge(this.doc, partial)));
  }

  /** A structural change (slot added or removed): edit a draft, renormalise. */
  mutate(edit: (draft: Record<string, unknown>) => void): void {
    const draft = JSON.parse(JSON.stringify(this.doc)) as Record<string, unknown>;
    edit(draft);
    this.adopt(makeArrangement(draft));
  }

  /** The export payload: the normalised document, pretty-printed. */
  toJson(): string {
    return `${JSON.stringify(this.doc, null, 2)}\n`;
  }
}
