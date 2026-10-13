/**
 * One row of the MIDI CC panel (windsor#784, the mockup's `.cc-row`): Part,
 * Parameter, Source, Range, Inv, Live, Learn and Delete, drawn from a
 * `CcRowView`. Every rule is the model's (`ccPanelModel.ts`); every click
 * hands its row to the panel's actions, which make the edit.
 */
import { CC_CHANNELS } from './ccPanelConstants';
import type { CcRangeEnd } from './ccPanelEdits';
import {
  CC_ANY,
  type CcLiveView,
  type CcRowView,
  type CcSelectOption,
  ccChannelOptions,
  ccDeviceOptions,
} from './ccPanelModel';
import { rangeValue, type RangeCellActions } from './ccPanelRange';
import { el } from './dom';

/** What a row's controls ask the panel to do. */
export interface CcRowActions extends RangeCellActions {
  device(row: CcRowView, device: string | null): void;
  channel(row: CcRowView, channel: number | null): void;
  invert(row: CcRowView): void;
  learn(row: CcRowView): void;
  cancelLearn(): void;
  remove(row: CcRowView): void;
}

/** What every row is drawn with besides its view. */
export interface CcRowContext {
  readonly midiOn: boolean;
  /** The connected inputs' names. */
  readonly connected: readonly string[];
  readonly actions: CcRowActions;
}

/** The parts of a row the live refresh repaints. */
export interface CcRowCells {
  readonly row: HTMLElement;
  readonly live: HTMLElement;
}

const button = (text: string, className = 'btn'): HTMLButtonElement => {
  const b = el('button', className, text) as HTMLButtonElement;
  b.type = 'button';
  return b;
};

/** A small `<select class="field">` over `options`, set to `value`. */
function picker(
  label: string,
  options: readonly CcSelectOption[],
  value: string,
  onPick: (value: string) => void,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'field';
  sel.setAttribute('aria-label', label);
  for (const option of options) sel.add(new Option(option.label, option.value));
  sel.value = value;
  sel.onchange = (): void => onPick(sel.value);
  return sel;
}

function partCell(view: CcRowView): HTMLElement {
  const cell = el('div', 'cc-part');
  const swatch = el('i');
  swatch.style.setProperty('--pc', view.partColor);
  cell.append(swatch, el('span', '', view.partName));
  return cell;
}

function paramCell(view: CcRowView): HTMLElement {
  const cell = el('div', 'cc-param');
  const kind = el('span', 'kind');
  const bar = el('i');
  bar.style.setProperty('--kc', view.kindColor);
  kind.append(bar, el('span', '', view.kindLine));
  cell.append(el('span', 'nm', view.name), kind);
  return cell;
}

function sourceCell(view: CcRowView, context: CcRowContext): HTMLElement {
  const cell = el('div', 'cc-src');
  const source = view.source;
  if (source.kind === 'listening') {
    cell.append(
      el('span', 'cc-listen', 'Move a knob on your controller…'),
      el('span', 'cc-heard', 'Esc or Cancel leaves nothing behind'),
    );
    return cell;
  }
  if (source.kind === 'heard') {
    const now = el('span', 'cc-heard-now', 'Heard ');
    now.append(el('b', '', `CC ${source.cc}`), ` · ${source.rest}`);
    cell.append(
      now,
      el('span', 'cc-heard', 'device and channel as heard; widen either to Any here'),
    );
    return cell;
  }
  const { actions } = context;
  const device = picker(
    'Device',
    ccDeviceOptions(source.device, context.connected, source.heardDevice),
    source.device ?? CC_ANY,
    (value) => actions.device(view, value === CC_ANY ? null : value),
  );
  const channel = picker(
    'Channel',
    ccChannelOptions(CC_CHANNELS),
    source.channel === null ? CC_ANY : String(source.channel),
    (value) => actions.channel(view, value === CC_ANY ? null : Number(value)),
  );
  channel.classList.add('ch');
  const line = el('div', 'line');
  line.append(device, channel, el('span', 'cc-chip', `CC ${source.cc}`));
  cell.append(line);
  if (source.heardLine) cell.append(el('span', 'cc-heard', source.heardLine));
  return cell;
}

function rangeCell(view: CcRowView, context: CcRowContext): HTMLElement {
  const cell = el('div', 'cc-range');
  // Learn's new row has no range until it commits, over the target's full range.
  if (view.range.length === 0) return cell;
  const ends: CcRangeEnd[] = view.range.length === 1 ? ['min'] : ['min', 'max'];
  ends.forEach((end, i) => {
    if (i > 0) cell.append('–');
    cell.append(rangeValue(view, end, view.range[i] ?? '', context.actions));
  });
  return cell;
}

function invCell(view: CcRowView, context: CcRowContext): HTMLElement {
  const cell = el('div', 'cc-inv-cell');
  if (!view.mapping) return cell;
  const inv = button('Inv', 'btn cc-inv');
  inv.title = 'Invert: CC 0 plays the top of the range';
  inv.setAttribute('aria-pressed', String(view.mapping.inverted));
  inv.onclick = (): void => context.actions.invert(view);
  cell.append(inv);
  return cell;
}

/** Fill a Live cell from its view. */
export function paintLive(cell: HTMLElement, live: CcLiveView): void {
  cell.className = `cc-live${live.tone === 'none' ? ' none' : ''}`;
  cell.replaceChildren();
  if (live.tone === 'value' || live.tone === 'none') cell.append(live.text);
  else cell.append(el('span', `pill ${live.tone}`, live.text));
  if (live.sub) cell.append(el('span', 'cc-sub', live.sub));
}

function learnCell(view: CcRowView, context: CcRowContext): HTMLElement {
  const cell = el('div', 'cc-learn');
  if (view.listening) {
    const cancel = button('Cancel');
    cancel.onclick = (): void => context.actions.cancelLearn();
    cell.append(cancel);
    return cell;
  }
  const learn = button('Learn');
  learn.title = 'Learn the source again: move a knob on your controller';
  learn.disabled = !context.midiOn;
  learn.onclick = (): void => context.actions.learn(view);
  cell.append(learn);
  return cell;
}

function deleteCell(view: CcRowView, context: CcRowContext): HTMLElement {
  const cell = el('div', 'cc-del');
  if (!view.mapping) return cell;
  const remove = button('×');
  remove.setAttribute('aria-label', `Delete the mapping on ${view.name}`);
  remove.onclick = (): void => context.actions.remove(view);
  cell.append(remove);
  return cell;
}

/** A row's element and its Live cell. */
export function ccRow(view: CcRowView, context: CcRowContext): CcRowCells {
  const row = el('div', 'cc-row');
  row.dataset.key = view.key;
  row.classList.toggle('dim', !context.midiOn);
  row.classList.toggle('flash', view.flash);
  const live = el('div', 'cc-live');
  live.style.setProperty('--lane-c', view.kindColor);
  if (context.midiOn) paintLive(live, view.live);
  else paintLive(live, { tone: 'none', text: '—', sub: null });
  row.append(
    partCell(view),
    paramCell(view),
    sourceCell(view, context),
    rangeCell(view, context),
    invCell(view, context),
    live,
    learnCell(view, context),
    deleteCell(view, context),
  );
  return { row, live };
}

/** The grid's head row. */
export function ccHeadRow(): HTMLElement {
  const head = el('div', 'cc-row head');
  for (const name of ['Part', 'Parameter', 'Source', 'Range', 'Inv', 'Live', 'Learn', ''])
    head.append(el('div', '', name));
  return head;
}
