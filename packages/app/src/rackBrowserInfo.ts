/**
 * The browser's info pane for a rack (windsor#884; record
 * `2026-10-17-racks` decision 18, the approved mockup's pane): the name,
 * `<category> · <source> · Rack`, the tags, the description, the rack rows
 * (Patch with its origin, Chain with each insert's power and a disconnected
 * key, Sequencer, Low cut), the embedded patch's summary line and envelope
 * sketch; then Load into <part>, and Rename, Delete and Export. The rules
 * are `rackBrowserModel.ts`; the actions `rackBrowserActions.ts`.
 */
import type { Envelope } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import { CARRIER_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import { drawEnv } from './envCanvas';
import { library } from './libraryModel';
import { patchInfo } from './patchBrowserModel';
import { deleteRack, exportRack, renameRack } from './rackBrowserActions';
import type { RackInfo, RackInsertInfo, RackRow } from './rackBrowserModel';
import { rackInfo, rackNameProblem } from './rackBrowserModel';
import { isRackWritable, rackEntry } from './rackLibrary';

export interface RackInfoHooks {
  /** Load the rack into the part, as a double-click or Enter does. */
  readonly load: (id: string, opener: HTMLElement) => void;
  /** After a rack action: select `next` if given, reload the bar and the pane, focus the results. */
  readonly done: (next?: string) => void;
}

const POWER = '⏻';

function button(label: string, title: string, enabled: boolean, cls = 'btn'): HTMLButtonElement {
  const node = el('button', cls, label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.disabled = !enabled;
  return node;
}

/** Runs an action and reports its failure as an error toast. */
function run(ctx: AppCtx, action: () => Promise<void>): void {
  action().catch((error: unknown) => ctx.notify(String(error), 'error'));
}

function insertLine(insert: RackInsertInfo): HTMLElement {
  const line = el('div', insert.enabled ? 'ins' : 'ins off');
  const power = el('span', 'pwr', POWER);
  power.title = insert.enabled ? 'On' : 'Off';
  line.append(power, el('span', 'kind', insert.label));
  if (insert.keyDisconnected) {
    const key = el('span', 'key', 'key disconnected');
    key.title = 'The sidechain key is written disconnected: a rack names no part';
    line.appendChild(key);
  } else if (!insert.enabled) line.appendChild(el('span', 'key', 'off'));
  return line;
}

/** The labelled rack rows, a member the rack lacks left out. */
function rackRows(info: RackInfo): HTMLElement {
  const list = el('dl', 'pb-rack');
  const row = (label: string, value: HTMLElement): void => {
    list.append(el('dt', '', label), value);
  };
  const patch = el('dd', '', info.patchName);
  patch.appendChild(
    el(
      'small',
      '',
      info.origin
        ? `from the library patch ${info.origin.name} (${info.origin.id})`
        : 'a patch of its own',
    ),
  );
  row('Patch', patch);
  const chain = el('dd', '');
  if (info.chain.length === 0) chain.appendChild(el('small', '', 'no effects'));
  for (const insert of info.chain) chain.appendChild(insertLine(insert));
  row('Chain', chain);
  if (info.sequencer !== null) row('Sequencer', el('dd', '', info.sequencer));
  if (info.lowCut !== null) row('Low cut', el('dd', '', info.lowCut));
  return list;
}

/** One observer for the pane's one sketch: it redraws when the canvas's box changes. */
let sketchObserver: ResizeObserver | null = null;

function envelopeSketch(env: Envelope | null): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'pb-env';
  canvas.setAttribute('aria-hidden', 'true');
  sketchObserver?.disconnect();
  if (env) {
    sketchObserver = new ResizeObserver(() => drawEnv(canvas, env, CARRIER_COLOR));
    sketchObserver.observe(canvas);
  }
  return canvas;
}

/** Rename's form in place of the name: Enter or Rename commits, Esc or Cancel puts the name back. */
function renameForm(
  ctx: AppCtx,
  row: RackRow,
  hooks: RackInfoHooks,
  back: () => void,
): HTMLElement {
  const form = el('form', 'pb-rename') as HTMLFormElement;
  const input = document.createElement('input');
  input.className = 'field';
  input.name = 'rack-browser-name';
  input.value = row.name;
  input.setAttribute('aria-label', 'Rack name');
  const commit = button('Rename', 'Rename the rack', true, 'btn primary');
  commit.type = 'submit';
  const cancel = button('Cancel', 'Keep the name', true);
  cancel.onclick = back;
  input.onkeydown = (event): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    back();
  };
  form.onsubmit = (event): void => {
    event.preventDefault();
    const name = input.value.trim();
    const entry = rackEntry(library, row.id);
    if (!entry || name === row.name) return back();
    const problem = rackNameProblem(name, library.racks, row.id);
    if (problem) return ctx.notify(problem, 'warning');
    run(ctx, async () => {
      await renameRack(ctx, entry, name);
      hooks.done(row.id);
    });
  };
  form.append(input, commit, cancel);
  queueMicrotask(() => input.select());
  return form;
}

/** The pane for `row`, or a line saying nothing is selected. */
// eslint-disable-next-line max-lines-per-function -- one pane: its fields, then its buttons wired in the order they show
export function rackBrowserInfo(
  ctx: AppCtx,
  row: RackRow | null,
  hooks: RackInfoHooks,
): HTMLElement {
  const pane = el('div', 'pb-info');
  const entry = row ? rackEntry(library, row.id) : undefined;
  if (!row || !entry) {
    pane.appendChild(el('p', 'hint', 'No rack matches the search and the facets.'));
    return pane;
  }
  const info = rackInfo(entry, row, library.entries);
  const patch = patchInfo(row, entry.patch);
  const part = partAt(ctx.model.doc, ctx.parts.selected);
  const writable = isRackWritable(library, row.id);
  const name = el('div', 'pb-name', row.name);
  const tags = el('div', 'pb-chips');
  for (const tag of row.tags) tags.appendChild(el('span', '', tag));
  const load = button(
    `Load into ${part?.name ?? 'part'}`,
    'Load this rack into the part: its patch, effects, and its low cut and sequencer where it carries them (Enter or a double-click)',
    part !== undefined,
    'btn primary',
  );
  load.onclick = (): void => hooks.load(row.id, load);
  const rename = button(
    'Rename',
    writable ? 'Rename your rack; the id stays' : 'Built-in racks are read-only',
    writable,
    'btn ghost',
  );
  rename.onclick = (): void => {
    const back = (): void => {
      form.replaceWith(name);
      rename.focus();
    };
    const form = renameForm(ctx, row, hooks, back);
    name.replaceWith(form);
  };
  const remove = button(
    'Delete',
    writable ? 'Remove from your racks; parts keep what they play' : 'Built-in racks are read-only',
    writable,
    'btn ghost',
  );
  remove.onclick = (): void =>
    run(ctx, async () => {
      if (await deleteRack(ctx, entry, remove)) hooks.done();
    });
  const download = button('Export', `Download ${row.id}.json`, true, 'btn ghost');
  download.onclick = (): void => exportRack(entry);
  const primary = el('div', 'pb-actions');
  primary.append(load);
  const manage = el('div', 'pb-actions');
  manage.append(rename, remove, download);
  pane.append(
    name,
    el('div', 'hint pb-detail', info.detail),
    tags,
    el('p', 'pb-desc', row.description),
    rackRows(info),
    el('div', 'hint pb-summary', patch.summary),
    envelopeSketch(patch.envelope),
    primary,
    manage,
    el(
      'p',
      'hint',
      "Built-in racks are read-only; Rename and Delete act on your racks. Loading copies the rack's patch into the song and replaces the part's chain, and its low cut and sequencer where the rack carries them.",
    ),
  );
  return pane;
}
