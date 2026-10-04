/**
 * The Roll's editing state (windsor#603 decisions 1 and 6): the selection,
 * and the edit in progress. A drag previews its edit as a draft the device
 * draws over the document, and writes it once, on release, through the
 * part edit path (`regionPatternChange` → `ctx.change`), so the edit is
 * heard on the next tick and undoes in one step.
 *
 * The selection is kept outside the device, per slot and region
 * (`rollSelection.ts`), so it survives the write's sort, a re-render and an
 * undo; during a drag it is the draft's, by index, and a drag that is
 * cancelled leaves it as it was before the drag.
 *
 * Delete or Backspace deletes the selection and Escape clears it, from one
 * window listener bound once and pointing at the device last drawn (a
 * listener per device would keep every discarded one alive). Escape with
 * nothing selected is left to Expand, which closes.
 */
import type { RollSequencerConfig } from '@windsor/engine';
import type { AppCtx } from './context';
import { regionPatternChange } from './partEdits';
import { type RollEdit, deleteNotes, settle } from './rollEdits';
import { type RollPlace, forgetGone, keepSelected, selectedIn } from './rollSelection';
import { readRollSource } from './rollSource';
import { isFieldFocused } from './songAutomationToolbar';

/** What the editor redraws. */
export interface RollEditorTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
  /** The device's body: the keys act only while it is on the page and shown. */
  readonly body: HTMLElement;
  /** Redraw the notes, the stems and the keys' marks (a drag, a selection). */
  previewNotes(): void;
  /** Redraw the whole roll (a loop in progress, a write). */
  repaint(): void;
}

/** One Roll device's selection and edit in progress. */
export class RollEditor {
  private draft: RollEdit | null = null;
  private readonly place: RollPlace;

  constructor(private readonly target: RollEditorTarget) {
    this.place = { slot: target.slot, region: target.region };
    forgetGone(target.ctx.model.doc);
    KEYS.editor = this;
    bindKeys();
  }

  /** The roll as the document has it. */
  stored(): RollSequencerConfig {
    const { ctx, slot, region } = this.target;
    const source = readRollSource(ctx.model.doc, slot, region);
    return { loopTicks: source.loopTicks, notes: source.notes };
  }

  /** The edit in progress, or null. */
  drafting(): RollSequencerConfig | null {
    return this.draft?.config ?? null;
  }

  /** The roll as drawn: the draft, else the document's. */
  current(): RollSequencerConfig {
    return this.draft?.config ?? this.stored();
  }

  /** The selected notes' indices in `current().notes`. */
  selected(): number[] {
    if (this.draft) return [...this.draft.selected];
    return selectedIn(this.place, this.stored().notes);
  }

  /** The pitches the selection is on, whose keys are marked. */
  selectedPitches(): Set<number> {
    const { notes } = this.current();
    return new Set(this.selected().flatMap((i) => (notes[i] ? [notes[i].pitch] : [])));
  }

  /** Select the notes at `indices` of `current().notes`, alone. */
  select(indices: readonly number[]): void {
    if (this.draft) this.draft = { ...this.draft, selected: indices };
    else keepSelected(this.place, this.stored().notes, indices);
    this.target.previewNotes();
  }

  /** Draw `edit` in progress, without writing the song. */
  preview(edit: RollEdit): void {
    this.draft = edit;
    this.target.previewNotes();
  }

  /** Draw a loop in progress, which redraws the whole roll. */
  previewLoop(config: RollSequencerConfig): void {
    this.draft = { config, selected: this.selected() };
    this.target.repaint();
  }

  /** Drop the edit in progress; the selection is the one kept from before it. */
  cancel(): void {
    if (!this.draft) return;
    this.draft = null;
    this.target.repaint();
  }

  /** Write `edit`, settled, as one undo step; false when the song refused it. */
  commit(edit: RollEdit): boolean {
    const settled = settle(edit);
    this.draft = null;
    keepSelected(this.place, settled.config.notes, settled.selected);
    const { ctx, slot, region } = this.target;
    const { loopTicks, notes } = settled.config;
    const partial = regionPatternChange(ctx.model.doc, slot, region, { loopTicks, notes });
    const ok = partial !== null && ctx.change(partial).ok;
    this.target.repaint();
    return ok;
  }

  /** A key for the device; true when it took it. */
  key(e: KeyboardEvent): boolean {
    const { body } = this.target;
    if (!body.isConnected || body.closest('[hidden]') !== null || isFieldFocused(e)) return false;
    const selected = this.selected();
    if (selected.length === 0) return false;
    if (e.key === 'Escape') {
      this.select([]);
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.commit(deleteNotes(this.current(), selected));
      return true;
    }
    return false;
  }
}

/** The device last drawn, which the keys act on. */
const KEYS: { editor: RollEditor | null } = { editor: null };
let bound = false;

function bindKeys(): void {
  if (bound) return;
  bound = true;
  // Capture, so a cleared selection keeps Escape from closing Expand as well.
  window.addEventListener(
    'keydown',
    (e) => {
      if (KEYS.editor?.key(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}
