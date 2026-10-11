/**
 * Bloom's card (windsor#712), built to the mockup tacowars approved on
 * 2026-10-11 (`docs/design/bloom-card-mockup.html`, windsor#711): all 15
 * controls on one page in five groups, with rules between them and no
 * captions.
 *
 * - Envelope: Swell and Sustain, and Freeze under them, a latching button
 *   with a lamp, filled in the chain's accent while it holds (the insert's
 *   on/off switch is the rail's ⏻).
 * - Generator: Shape and Bright, Octave (six steps), then the Key and Scale
 *   pickers in one wide column. They read as the transport's do (windsor#728):
 *   Key its note names, Scale `chromatic` first, `song key` in its own group
 *   (windsor#717), then Windsor's scales under the transport's groups and
 *   names. On `song key` Key is disabled and shows the song's key, as the
 *   transport's Key does; the bloom's own key stays underneath.
 * - Bands: Low and High (note names; they never cross), then Focus.
 * - Dynamics: Density, read as the compressor's ratio.
 * - Output: Amount and Spread, then Mix at the big dial, last.
 *
 * No slot area yet: Bloom becomes a wet-path host in a later PR. Each
 * control commits the whole insert through `ctx.change`. A knob, and
 * Freeze, locks while a lane on its field is on.
 */
import { DEFAULT_BLOOM } from '@windsor/engine';
import type { BloomScale, BloomSpec } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import type { SelectGroup } from './dom';
import type { InsertCard } from './insertCards';
import {
  BLOOM_KEY_ITEMS,
  BLOOM_KNOBS,
  BLOOM_SCALE_OFF_ITEMS,
  INSERT_LABELS,
} from './insertKnobTables';
import type { InsertKnobEntry } from './insertKnobTables';
import { bigInsertKnobs, insertFieldLock, insertKnob, insertsOf, pickKnobs } from './insertKnobs';
import { insertColumn, insertPage, insertRule, insertSelect, wideColumn } from './insertLayout';
import { targetChange } from './insertTarget';
import { KEY_OPTIONS, SCALE_OPTION_GROUPS } from './transportTables';
import type { InsertTarget } from './insertTarget';
import { lockNotice, type KnobAutomation } from './knobAutomation';
import { followAutomation, paintLock, switchShowsOn } from './knobLock';

const NAME = INSERT_LABELS.bloom;

interface BloomView {
  readonly ctx: AppCtx;
  readonly slot: InsertTarget;
  readonly index: number;
  current(): BloomSpec;
  commit(next: BloomSpec): void;
}

/** Freeze's tooltip, off and on (the mockup's). */
const freezeTitle = (on: boolean): string =>
  on
    ? 'Freeze: holding every sounding band. Press to let go'
    : 'Freeze: hold every sounding band as a drone';

/**
 * Freeze: a latching button with a lamp. While a lane on `freeze` holds it,
 * it shows the lane's level in the lane's colour and a press only says so.
 */
function freezeButton(view: BloomView): HTMLElement {
  const lock = insertFieldLock(view.ctx, view.slot, view.index, 'freeze').automation;
  const lockNow = (): KnobAutomation | null => lock?.() ?? null;
  const button = document.createElement('button');
  button.className = 'bloom-freeze';
  button.type = 'button';
  button.append(el('i'), document.createTextNode('Freeze'));
  const render = (): void => {
    const held = lockNow();
    const on = switchShowsOn(view.current().freeze, held);
    button.setAttribute('aria-pressed', String(on));
    button.title = freezeTitle(on);
    paintLock(button, held);
  };
  button.onclick = (): void => {
    const held = lockNow();
    if (held) {
      view.ctx.notify(lockNotice(`${NAME} Freeze`, held));
      return;
    }
    view.commit({ ...view.current(), freeze: !view.current().freeze });
    render();
  };
  render();
  if (lock) followAutomation(button, lockNow, render);
  return button;
}

/** Scale's Song key (windsor#717): the song's root and scale, resolved by the engine. */
const SONG_KEY: BloomScale = 'song';

/** Scale's groups: `song key` alone, then the transport's. */
export const BLOOM_SCALE_GROUPS: readonly SelectGroup[] = [
  { group: 'Song', options: [{ value: SONG_KEY, label: 'song key' }] },
  ...SCALE_OPTION_GROUPS,
];

/**
 * What Key shows: the bloom's own key, or on Song key the song's (`root`, a
 * pitch class), named as the transport's Key names it, and disabled.
 */
export function bloomKeyShown(
  spec: Pick<BloomSpec, 'key' | 'scale'>,
  root: number,
): { readonly value: string; readonly disabled: boolean } {
  if (spec.scale !== SONG_KEY) return { value: spec.key, disabled: false };
  const song = KEY_OPTIONS.find((option) => option.value === String(root));
  return { value: song?.label ?? spec.key, disabled: true };
}

/** Key and Scale: the generator's pickers, neither a lane's, in one wide column. */
function keyAndScale(view: BloomView): HTMLElement {
  const spec = view.current();
  const key = insertSelect({
    label: 'Key',
    options: BLOOM_KEY_ITEMS,
    value: spec.key,
    change: (next) => view.commit({ ...view.current(), key: next as BloomSpec['key'] }),
  });
  const keySelect = key.querySelector('select')!;
  const paintKey = (): void => {
    const shown = bloomKeyShown(view.current(), view.ctx.model.doc.harmony.root);
    keySelect.value = shown.value;
    keySelect.disabled = shown.disabled;
  };
  paintKey();
  return wideColumn(
    key,
    insertSelect({
      label: 'Scale',
      options: BLOOM_SCALE_OFF_ITEMS,
      groups: BLOOM_SCALE_GROUPS,
      value: spec.scale,
      change: (scale) => {
        view.commit({ ...view.current(), scale: scale as BloomSpec['scale'] });
        paintKey();
      },
    }),
  );
}

function page(view: BloomView): HTMLElement {
  const knob = (field: InsertKnobEntry<BloomSpec>['f']): HTMLElement =>
    insertKnob(view.ctx, view.slot, view.index, pickKnobs(BLOOM_KNOBS, [field])[0]!);
  const column = (...fields: InsertKnobEntry<BloomSpec>['f'][]): HTMLElement =>
    insertColumn(...fields.map(knob));
  // Shape's and Bright's readouts are the longest; a fixed width keeps the page still under a drag.
  const shapeAndBright = column('shape', 'bright');
  shapeAndBright.classList.add('bloom-wide');
  return insertPage(
    insertColumn(knob('swell'), knob('sustain'), freezeButton(view)),
    insertRule(),
    shapeAndBright,
    column('octave'),
    keyAndScale(view),
    insertRule(),
    column('low', 'high'),
    column('focus'),
    insertRule(),
    column('density'),
    insertRule(),
    column('amount', 'spread'),
    ...bigInsertKnobs(view.ctx, view.slot, view.index, pickKnobs(BLOOM_KNOBS, ['mix'])),
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
  return [{ name: NAME, build: () => page(view) }];
};
