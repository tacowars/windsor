/**
 * The Tape card's Advanced section (windsor#291): a disclosure at the end of
 * the Tape page, collapsed by default, over the magnetic core's three
 * controls. Bend, Width and Saturation each read 0–100 % over the engine's
 * `TAPE_CORE_BOUNDS`; while the insert has no `core` they show its model's
 * row, and turning one writes all three into `core` (one undo step, named
 * after the knob). Use model clears `core`, and the header says "Custom"
 * while one is set. Whether a section is open is this session's view state,
 * by the insert's rack key, never the song's.
 */
import { DEFAULT_TAPE, TAPE_CORE_BOUNDS, type TapeSpec } from '@windsor/engine';
import type { AppCtx } from './context';
import { STRIP_COLOR } from './consoleColors';
import { el } from './dom';
import { withGesture } from './gestureHooks';
import { insertColumn } from './insertLayout';
import { insertIdAt, rackKey } from './insertRackModel';
import type { InsertTarget } from './insertTarget';
import { insertChange, insertsOf } from './insertTarget';
import { makeKnob, type KnobElement } from './knob';
import {
  coreKnobValue,
  isCustomCore,
  modelCoreValue,
  withCoreKnob,
  withModelCore,
} from './tapeCardModel';
import { TAPE_ADVANCED_TEXT as T, TAPE_CORE_KNOBS, tapeCoreReadout } from './tapeTables';

/** The open sections, by rack key: session view state only. */
const open = new Set<string>();

interface Section {
  current(): TapeSpec;
  /** Write `spec` to the song: one live change, the card left as it is. */
  edit(spec: TapeSpec): void;
}

function section(ctx: AppCtx, target: InsertTarget, index: number): Section {
  return {
    current: () => {
      const spec = insertsOf(ctx, target)[index];
      return spec?.kind === 'tape' ? spec : DEFAULT_TAPE;
    },
    edit: (spec) => {
      const inserts = [...insertsOf(ctx, target)];
      if (inserts[index]?.kind !== 'tape') return;
      inserts[index] = spec;
      ctx.change(insertChange(target, inserts));
    },
  };
}

/** The header: a vertical toggle naming the section, with "Custom" while a `core` is set. */
function header(expanded: boolean, toggle: () => void): { button: HTMLElement; mark: HTMLElement } {
  const button = el('button', 'tape-advanced-toggle') as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('aria-expanded', String(expanded));
  button.title = expanded ? T.closeTitle : T.openTitle;
  const mark = el('span', 'tape-advanced-custom', T.custom);
  button.append(
    el('span', 'tape-advanced-caret', expanded ? '◂' : '▸'),
    el('span', '', T.header),
    mark,
  );
  button.onclick = toggle;
  return { button, mark };
}

/** The three knobs and Use model, in two columns of two. */
function controls(s: Section, mark: () => void): HTMLElement[] {
  // A turn writes all three, and may bring another to the box's edge (Vintage's Width): every
  // knob re-reads, and the header's mark follows.
  const sync = (): void => {
    for (const knob of knobs) knob.refresh();
    mark();
  };
  const knobs: KnobElement[] = TAPE_CORE_KNOBS.map(({ f, label, title }) => {
    const [min, max] = TAPE_CORE_BOUNDS[f];
    const knob = makeKnob({
      label,
      min,
      max,
      def: modelCoreValue(s.current(), f),
      fmt: (v) => tapeCoreReadout(f, v),
      color: STRIP_COLOR,
      dial: 'rack',
      get: () => coreKnobValue(s.current(), f),
      set: (value) => s.edit(withCoreKnob(s.current(), f, value)),
      onChange: sync,
    });
    knob.title = `${title}. ${knob.title}`;
    return knob;
  });
  const use = el('button', 'btn', T.useModel) as HTMLButtonElement;
  use.type = 'button';
  use.title = T.useModelTitle;
  use.onclick = (): void =>
    withGesture(T.useModel, () => {
      s.edit(withModelCore(s.current()));
      sync();
    });
  return [insertColumn(knobs[0]!, knobs[1]!), insertColumn(knobs[2]!, use)];
}

/** The Advanced section for the Tape insert at `index` in `target`'s chain. */
export function tapeAdvanced(ctx: AppCtx, target: InsertTarget, index: number): HTMLElement {
  const s = section(ctx, target, index);
  const key = rackKey(target, insertIdAt(insertsOf(ctx, target), index));
  const root = el('div', 'tape-advanced');
  const paint = (): void => {
    const expanded = open.has(key);
    const { button, mark } = header(expanded, () => {
      if (open.has(key)) open.delete(key);
      else open.add(key);
      paint();
      root.querySelector<HTMLElement>('.tape-advanced-toggle')?.focus();
    });
    const markCustom = (): void => void (mark.hidden = !isCustomCore(s.current()));
    markCustom();
    root.replaceChildren(button, ...(expanded ? controls(s, markCustom) : []));
  };
  paint();
  return root;
}
