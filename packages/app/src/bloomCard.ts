/**
 * bloom's card (windsor#712). A STAND-IN until tacowars approves the card's
 * mockup (windsor#711): every one of the 15 controls on its real range and
 * readout, in #711's groups on one page, split by rules, and nothing more.
 * The card is rebuilt to the approved mockup before the insert merges.
 *
 * - Envelope: Swell and Sustain, and Freeze, a latching switch of its own
 *   (the insert's on/off switch is the rack's rail).
 * - Generator: Shape and Bright, and the Octave, Key and Scale pickers.
 * - Bands: Low and High (note names) and Focus.
 * - Dynamics: Density, read as the compressor's ratio.
 * - Output: Amount, Spread and Mix.
 *
 * Each control commits the whole insert through `ctx.change`. A knob, and
 * Freeze, locks while a lane on its field is on.
 */
import { BLOOM_KEYS, BLOOM_OCTAVES, BLOOM_SCALES, DEFAULT_BLOOM } from '@windsor/engine';
import type { BloomSpec } from '@windsor/engine';
import type { AppCtx } from './context';
import type { InsertCard } from './insertCards';
import { BLOOM_KNOBS, bloomScaleLabel, fmtBloomOctave } from './insertKnobTables';
import type { InsertKnobEntry } from './insertKnobTables';
import { insertFieldLock, insertKnobs, insertsOf, pickKnobs } from './insertKnobs';
import { insertPage, insertRule, insertSelect, insertSwitch, wideColumn } from './insertLayout';
import { targetChange } from './insertTarget';
import type { InsertTarget } from './insertTarget';
import { lockNotice, type KnobAutomation } from './knobAutomation';
import { followAutomation, paintLock, switchShowsOn } from './knobLock';

interface BloomView {
  readonly ctx: AppCtx;
  readonly slot: InsertTarget;
  readonly index: number;
  current(): BloomSpec;
  commit(next: BloomSpec): void;
}

/** Freeze: a latching switch, lit by and following a lane on `freeze` while one holds it. */
function freezeSwitch(view: BloomView): HTMLElement {
  const lock = insertFieldLock(view.ctx, view.slot, view.index, 'freeze').automation;
  const lockNow = (): KnobAutomation | null => lock?.() ?? null;
  const wrap = insertSwitch('Freeze', view.current().freeze, (freeze) => {
    const held = lockNow();
    if (held) {
      render();
      view.ctx.notify(lockNotice('bloom Freeze', held));
      return;
    }
    view.commit({ ...view.current(), freeze });
  });
  wrap.title = 'Hold every sounding band as a drone; new input passes dry';
  const input = wrap.querySelector('input')!;
  const render = (): void => {
    const held = lockNow();
    input.checked = switchShowsOn(view.current().freeze, held);
    paintLock(wrap, held);
  };
  render();
  if (lock) followAutomation(wrap, lockNow, render);
  return wrap;
}

/** Octave, Key and Scale: the generator's pickers, none a lane's. */
function pitchPickers(view: BloomView): HTMLElement {
  const spec = view.current();
  return wideColumn(
    insertSelect({
      label: 'Octave',
      options: BLOOM_OCTAVES.map((st) => [String(st), fmtBloomOctave(st)] as const),
      value: String(spec.octave),
      change: (value) => view.commit({ ...view.current(), octave: Number(value) }),
    }),
    insertSelect({
      label: 'Key',
      options: BLOOM_KEYS.map((key) => [key, key] as const),
      value: spec.key,
      change: (key) => view.commit({ ...view.current(), key: key as BloomSpec['key'] }),
    }),
    insertSelect({
      label: 'Scale',
      options: BLOOM_SCALES.map((scale) => [scale, bloomScaleLabel(scale)] as const),
      value: spec.scale,
      change: (scale) => view.commit({ ...view.current(), scale: scale as BloomSpec['scale'] }),
    }),
  );
}

function page(view: BloomView): HTMLElement {
  const knobs = (fields: readonly InsertKnobEntry<BloomSpec>['f'][]): HTMLElement[] =>
    insertKnobs(view.ctx, view.slot, view.index, pickKnobs(BLOOM_KNOBS, fields));
  return insertPage(
    ...knobs(['swell', 'sustain']),
    wideColumn(freezeSwitch(view)),
    insertRule(),
    ...knobs(['shape', 'bright']),
    pitchPickers(view),
    insertRule(),
    ...knobs(['low', 'high', 'focus']),
    insertRule(),
    ...knobs(['density']),
    insertRule(),
    ...knobs(['amount', 'spread', 'mix']),
  );
}

export const bloomCard: InsertCard = (ctx, slot, index) => {
  const view: BloomView = {
    ctx,
    slot,
    index,
    current: () => {
      const spec = insertsOf(ctx, slot)[index];
      return spec?.kind === 'bloom' ? spec : DEFAULT_BLOOM;
    },
    commit: (next) => {
      const inserts = [...insertsOf(ctx, slot)];
      if (inserts[index]?.kind !== 'bloom') return;
      inserts[index] = next;
      ctx.change(targetChange(ctx, slot, inserts));
    },
  };
  return [{ name: 'bloom', build: () => page(view) }];
};
