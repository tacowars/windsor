/**
 * The envelope picker's list (windsor#707 decisions 4 and 5; the approved
 * mockup's `.renv-list`): the counts at its head, a line when a limit is
 * reached, this roll's envelopes first, marked with their chips, then the
 * Song tab's voice sections with every other target, a refused one
 * disabled and a target with a song lane tagged. The rules are
 * `rollEnvelopePicker.ts`'s.
 *
 * The list sits on the page, fixed under the picker's button, so the
 * device's frame never clips it. A press outside it, Escape, or a pick
 * closes it.
 */
import { el } from './dom';
import type { EnvelopePicker, MarkedTarget, OpenTarget } from './rollEnvelopePicker';
import {
  ROLL_ENVELOPE_LIST_PX as PX,
  ROLL_ENVELOPE_TEXT as T,
  envCountText,
  slotCountText,
} from './rollEnvelopeTables';

/** An open list. */
export interface EnvelopeList {
  close(): void;
}

function option(className: string, label: string, tag: string): HTMLButtonElement {
  const node = el('button', `renv-opt${className}`) as HTMLButtonElement;
  node.type = 'button';
  node.setAttribute('role', 'option');
  node.appendChild(el('span', 'nm', label));
  if (tag) node.appendChild(el('span', 'tag', tag));
  return node;
}

function markedOption(target: MarkedTarget): HTMLButtonElement {
  const tag = target.on ? (target.shown ? T.shown : '') : T.off;
  const node = option(` marked${target.on ? '' : ' off'}`, target.label, tag);
  node.prepend(el('span', 'auto-chip'));
  node.setAttribute('aria-selected', String(target.shown));
  if (target.shown) node.setAttribute('aria-current', 'true');
  return node;
}

function openOption(target: OpenTarget): HTMLButtonElement {
  const node = option('', target.label, target.lane ? T.lane : '');
  node.disabled = target.refused !== null;
  if (target.refused) node.title = target.refused === 'envFull' ? T.envFullTitle : T.slotsFullTitle;
  return node;
}

/** The list's content for `picker`; `pick` hears a press on a target that takes it. */
function listBody(picker: EnvelopePicker, pick: (path: string) => void): HTMLElement[] {
  const full = picker.envFull || picker.slotsFull;
  const head = el('div', `renv-list-head auto-count${full ? ' full' : ''}`);
  head.append(
    el('span', '', envCountText(picker.envelopes, picker.envelopesMax)),
    el('span', '', slotCountText(picker.slots, picker.slotsMax)),
  );
  const nodes: HTMLElement[] = [head];
  if (picker.slotsFull) nodes.push(el('div', 'renv-list-note', T.slotsFull));
  else if (picker.envFull) nodes.push(el('div', 'renv-list-note', T.envFull));
  const wire = (node: HTMLButtonElement, path: string): HTMLButtonElement => {
    node.onclick = () => pick(path);
    return node;
  };
  if (picker.marked.length > 0) {
    nodes.push(el('div', 'renv-group', T.marked));
    for (const target of picker.marked) nodes.push(wire(markedOption(target), target.path));
  }
  for (const group of picker.groups) {
    nodes.push(el('div', 'renv-group', group.label));
    for (const target of group.targets) nodes.push(wire(openOption(target), target.path));
  }
  return nodes;
}

/** Place the list under `anchor`, or over it when the window has more room above. */
function place(list: HTMLElement, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  const below = window.innerHeight - box.bottom - PX.gap - PX.edge;
  const above = box.top - PX.gap - PX.edge;
  const up = below < PX.maxHeight && above > below;
  list.style.maxHeight = `${Math.min(PX.maxHeight, up ? above : below)}px`;
  list.style.width = `${PX.width}px`;
  const left = Math.max(PX.edge, Math.min(box.left, window.innerWidth - PX.width - PX.edge));
  list.style.left = `${left}px`;
  if (up) list.style.bottom = `${window.innerHeight - box.top + PX.gap}px`;
  else list.style.top = `${box.bottom + PX.gap}px`;
}

/** Open the list under `anchor`; `pick` hears a target, `closed` the list closing for any reason. */
export function openEnvelopeList(
  anchor: HTMLElement,
  picker: EnvelopePicker,
  hooks: { pick(path: string): void; closed(): void },
): EnvelopeList {
  const list = el('div', 'renv-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', T.listLabel);
  const outside = (e: PointerEvent): void => {
    if (e.target instanceof Node && (list.contains(e.target) || anchor.contains(e.target))) return;
    close();
  };
  const escape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  let open = true;
  function close(): void {
    if (!open) return;
    open = false;
    list.remove();
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('keydown', escape, true);
    hooks.closed();
  }
  list.append(
    ...listBody(picker, (path) => {
      close();
      hooks.pick(path);
    }),
  );
  document.body.appendChild(list);
  place(list, anchor);
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('keydown', escape, true);
  return { close };
}
