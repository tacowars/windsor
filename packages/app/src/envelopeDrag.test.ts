/**
 * Dragging a curve from one envelope display onto another (#588).
 *
 * The drag is a state machine with three collaborators — "what slot is under
 * this point", "paint this frame" and "do the transfer" — so the whole
 * behaviour is testable with fakes and no browser: a click that must stay
 * inert, a threshold, Shift read at release, Escape and a release over
 * nothing. The second half follows the drop all the way into the document,
 * because UI movement alone is not evidence that the export changed.
 */
import { describe, expect, it } from 'vitest';

import { makePatch } from '../../../packages/client/src/audio/index-for-editor';
import { DocumentModel } from './documentModel';
import {
  type DragPaint,
  ENVELOPE_DRAG_THRESHOLD_PX,
  type EnvelopeDragHost,
  type TransferKind,
  applyEnvelopeTransfer,
  createEnvelopeDrag,
} from './envelopeDrag';
import type { EnvelopeSlot } from './envelopeTransfer';
import { hooks, partsState } from './patchState';

/** A page with an A canvas on the left, a C canvas on the right, gaps between. */
class FakePage implements EnvelopeDragHost {
  readonly frames: (DragPaint | null)[] = [];
  readonly applied: { kind: TransferKind; from: EnvelopeSlot; to: EnvelopeSlot }[] = [];
  readonly slots: Record<number, EnvelopeSlot> = { 0: 'ops.0.env', 100: 'ops.2.env' };

  slotAt(x: number): EnvelopeSlot | null {
    return this.slots[x] ?? null;
  }
  paint(state: DragPaint | null): void {
    this.frames.push(state);
  }
  apply(kind: TransferKind, from: EnvelopeSlot, to: EnvelopeSlot): void {
    this.applied.push({ kind, from, to });
  }
  /** The slot highlighted by the last painted frame, and how. */
  get lastTarget(): string | null {
    const frame = this.frames[this.frames.length - 1];
    return frame ? `${frame.kind}:${frame.over ?? 'none'}` : null;
  }
}

/** Past the threshold, in one hop, so the drag is live. */
const PAST = ENVELOPE_DRAG_THRESHOLD_PX + 1;

describe('the envelope drag', () => {
  it('leaves a click on a canvas inert', () => {
    const page = new FakePage();
    const drag = createEnvelopeDrag(page);
    drag.down('ops.0.env', 0, 0);
    drag.move(1, 0, false);
    expect(drag.dragging).toBe(false);
    drag.up(0, 0, false);
    expect(page.applied).toEqual([]);
    expect(page.frames).toEqual([]);
  });

  it('starts once the pointer has travelled the threshold', () => {
    const page = new FakePage();
    const drag = createEnvelopeDrag(page);
    drag.down('ops.0.env', 0, 0);
    drag.move(ENVELOPE_DRAG_THRESHOLD_PX - 1, 0, false);
    expect(drag.dragging).toBe(false);
    drag.move(PAST, 0, false);
    expect(drag.dragging).toBe(true);
    // Once live it stays live, even back inside the threshold.
    drag.move(0, 0, false);
    expect(drag.dragging).toBe(true);
  });

  it('copies on a release over another slot, and clears the highlight after', () => {
    const page = new FakePage();
    const drag = createEnvelopeDrag(page);
    drag.down('ops.0.env', 0, 0);
    drag.move(PAST, 0, false);
    expect(page.lastTarget).toBe('copy:none');
    drag.move(100, 0, false);
    expect(page.lastTarget).toBe('copy:ops.2.env');

    drag.up(100, 0, false);
    expect(page.applied).toEqual([{ kind: 'copy', from: 'ops.0.env', to: 'ops.2.env' }]);
    expect(page.frames[page.frames.length - 1]).toBeNull();
    expect(drag.dragging).toBe(false);
  });

  it('swaps when Shift is held at release, whatever it was during the move', () => {
    const page = new FakePage();
    const drag = createEnvelopeDrag(page);
    drag.down('ops.0.env', 0, 0);
    drag.move(100, 0, false);
    drag.up(100, 0, true);
    expect(page.applied).toEqual([{ kind: 'swap', from: 'ops.0.env', to: 'ops.2.env' }]);
  });

  it('copies when Shift was held during the move but let go before release', () => {
    const page = new FakePage();
    const drag = createEnvelopeDrag(page);
    drag.down('ops.0.env', 0, 0);
    drag.move(100, 0, true);
    expect(page.lastTarget).toBe('swap:ops.2.env');
    drag.shift(false);
    expect(page.lastTarget).toBe('copy:ops.2.env');
    drag.up(100, 0, false);
    expect(page.applied).toEqual([{ kind: 'copy', from: 'ops.0.env', to: 'ops.2.env' }]);
  });

  it('does nothing on a release outside every slot, or back on the source', () => {
    const page = new FakePage();
    const drag = createEnvelopeDrag(page);
    drag.down('ops.0.env', 0, 0);
    drag.move(100, 0, false);
    drag.up(50, 0, false);
    expect(page.applied).toEqual([]);
    expect(page.frames[page.frames.length - 1]).toBeNull();

    drag.down('ops.0.env', 0, 0);
    drag.move(100, 0, false);
    drag.up(0, 0, false);
    expect(page.applied).toEqual([]);
  });

  it('cancels on Escape, and a later release changes nothing', () => {
    const page = new FakePage();
    const drag = createEnvelopeDrag(page);
    drag.down('ops.0.env', 0, 0);
    drag.move(100, 0, false);
    drag.cancel();
    expect(drag.dragging).toBe(false);
    expect(page.frames[page.frames.length - 1]).toBeNull();

    drag.up(100, 0, false);
    expect(page.applied).toEqual([]);
  });

  it('ignores movement and Shift with no press behind them', () => {
    const page = new FakePage();
    const drag = createEnvelopeDrag(page);
    drag.move(100, 0, false);
    drag.shift(true);
    drag.up(100, 0, false);
    expect(page.frames).toEqual([]);
    expect(page.applied).toEqual([]);
  });
});

/** The minimal song the console edits: one part playing one document patch. */
const SONG = {
  seed: 204,
  bpm: 96,
  key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
  drone: { part: 'drone', preset: 'drone-sqr', velocity: 0.8 },
};

describe('a drop, all the way into the document', () => {
  it('lands the copied envelope in the exported patches and round-trips it', () => {
    const model = new DocumentModel(SONG);
    const previousCommit = hooks.commit;
    const previousRefresh = hooks.refresh;
    let refreshes = 0;
    let commits = 0;
    partsState.patch = makePatch(model.doc.patches?.['drone-sqr']);
    hooks.commit = (patch): void => {
      commits++;
      model.merge({ patches: { 'drone-sqr': patch } });
    };
    hooks.refresh = (): void => {
      refreshes++;
    };
    try {
      // A shape nothing else in the patch has, so finding it downstream is proof.
      const source = partsState.patch.ops[0]?.env;
      if (!source) throw new Error('patch has no operator A');
      source.attackTime = 3.5;
      source.keyScale = 0.375;
      source.loopMode = 1;

      expect(applyEnvelopeTransfer('copy', 'ops.0.env', 'ops.2.env')).toBe(true);
      expect(commits).toBe(1);
      expect(refreshes).toBe(1);

      const landed = model.doc.patches?.['drone-sqr']?.ops[2]?.env;
      expect(landed?.attackTime).toBe(source.attackTime);
      expect(landed?.keyScale).toBe(source.keyScale);
      expect(landed?.loopMode).toBe(source.loopMode);

      const reread = new DocumentModel(JSON.parse(model.toJson()));
      expect(reread.usable).toBe(true);
      expect(reread.doc.patches?.['drone-sqr']?.ops[2]?.env).toEqual(landed);
    } finally {
      hooks.commit = previousCommit;
      hooks.refresh = previousRefresh;
    }
  });

  it('commits nothing when the drop is onto the slot it came from', () => {
    const previousCommit = hooks.commit;
    let commits = 0;
    partsState.patch = makePatch();
    hooks.commit = (): void => {
      commits++;
    };
    try {
      expect(applyEnvelopeTransfer('copy', 'filter.env', 'filter.env')).toBe(false);
      expect(applyEnvelopeTransfer('swap', 'pitchEnv', 'pitchEnv')).toBe(false);
      expect(commits).toBe(0);
    } finally {
      hooks.commit = previousCommit;
    }
  });
});
