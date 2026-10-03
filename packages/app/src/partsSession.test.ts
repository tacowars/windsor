/**
 * The one part selection (windsor#462, windsor#470): a pick from any tab
 * reloads the working patch, so the next knob edit writes into the picked
 * part's preset; the keyboard's bend and wheel follow every change through
 * the session's listener; and a song switch or an undo leaves the selection
 * on a part that exists at once, with no Parts render to repair it.
 */
import { describe, expect, it } from 'vitest';
import type { AudioPart } from '@windsor/engine';
import { makePatch, partAt, removePart } from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import { Keyboard } from './keyboard';
import { addPartLive } from './partEdits';
import { addPart, newSong } from './songParts';

/** A live part with only the two expression params the keyboard hands over. */
const livePart = (): AudioPart =>
  ({ pitchBend: { value: 0 }, modWheel: { value: 0 } }) as unknown as AudioPart;

/** A console whose host has a live part on every slot, with the Parts tab hidden behind Song. */
function openContext(): { ctx: AppContext<TabPanel>; live: Map<number, AudioPart> } {
  const live = new Map<number, AudioPart>();
  const host: ContextHost = {
    apply: () => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: (slot) => {
      if (!live.has(slot)) live.set(slot, livePart());
      return live.get(slot) ?? null;
    },
  };
  const ctx = new AppContext<TabPanel>({
    host: host as EngineHost,
    model: new DocumentModel(newSong()),
    notify: () => undefined,
  });
  ctx.addTab('parts', { hidden: false }, () => {});
  ctx.addTab('song', { hidden: true }, () => {});
  ctx.activate('song');
  return { ctx, live };
}

describe('the part selection', () => {
  it('reloads the working patch, so a knob edit after a pick lands on the picked part only', () => {
    const { ctx } = openContext();
    expect(addPartLive(ctx)).toBe(1);
    const preset = (slot: number): string => partAt(ctx.model.doc, slot)?.preset ?? '';
    ctx.change({ patches: { [preset(1)]: makePatch({ name: 'one' }) } });
    ctx.parts.pick(0);
    ctx.parts.patch = makePatch({ name: 'zero, edited' });
    ctx.parts.push();
    const picks = ctx.parts.picks;

    expect(ctx.parts.pick(1)).toBe(true);
    expect(ctx.parts.picks).toBe(picks + 1);
    expect(ctx.parts.pick(1)).toBe(false);
    expect(ctx.parts.picks).toBe(picks + 1);
    expect(ctx.parts.patch.name).toBe('one');
    ctx.parts.patch.name = 'one, edited';
    ctx.parts.push();
    expect(ctx.model.doc.patches?.[preset(1)]?.name).toBe('one, edited');
    expect(ctx.model.doc.patches?.[preset(0)]?.name).toBe('zero, edited');
  });

  it("hands the keyboard's bend and wheel to a part the Song view picks", () => {
    const { ctx, live } = openContext();
    addPartLive(ctx);
    ctx.parts.pick(0);
    const keyboard = new Keyboard(() => ctx.livePart());
    ctx.parts.onSelect(() => keyboard.followPart());
    const sink = keyboard.midiSink('test');
    sink.bend(2);
    sink.modWheel(0.5);

    ctx.parts.pick(1);
    const [zero, one] = [live.get(0), live.get(1)];
    expect([zero?.pitchBend.value, zero?.modWheel.value]).toEqual([0, 0]);
    expect([one?.pitchBend.value, one?.modWheel.value]).toEqual([2, 0.5]);
  });

  it('opens a song whose only part is slot 1 on slot 1, live at once', async () => {
    const { ctx } = openContext();
    const added = addPart(ctx.model.doc);
    if (!added) throw new Error('a new song has room for a second part');
    expect(await ctx.importDoc(removePart(ctx.model.preview(added.doc), 0))).toBe(true);
    expect(ctx.parts.selected).toBe(1);
    expect(ctx.livePart()).not.toBeNull();
  });

  it('leaves the selection on a part that exists when an undo takes the selected part away', () => {
    const { ctx } = openContext();
    expect(addPartLive(ctx)).toBe(1);
    ctx.activate('song');
    const picks = ctx.parts.picks;
    expect(ctx.undo()).toBe(true);
    expect(ctx.parts.selected).toBe(0);
    expect(ctx.parts.picks).toBe(picks);
    expect(ctx.livePart()).not.toBeNull();
  });
});
