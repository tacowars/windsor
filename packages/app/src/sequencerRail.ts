/**
 * Every sequencer device's side rail (windsor#368, record
 * `2026-10-01-sequencer-rack-devices` decision 2; generalised from the
 * Euclid card's rail, windsor#356). Top down: the part's accent dot, the
 * kind's name written vertically (a click folds the device to its rail),
 * then at the foot the device's own buttons (Euclid's lane-view toggle and
 * **?**), the region as `n/m`, and Split and Delete region as icon buttons.
 * The insert rack's rail (`.insert-rail`) is the look; the classes are the
 * sequencer's own, sharing its tokens.
 */
import { el, html } from './dom';
import type { RegionBadge } from './sequencerDeviceModel';

const ICON_SPLIT =
  '<rect x="1" y="3" width="4" height="6" rx="1"/><rect x="7" y="3" width="4" height="6" rx="1"/>' +
  '<path d="M6 1v10" stroke-dasharray="1.5 1.5"/>';
const ICON_DELETE = '<path d="M2 3h8M4.5 3V1.8h3V3M3 3l.6 7.2h4.8L9 3M5 5v3.5M7 5v3.5"/>';

/** One 18 px rail button, its label its tooltip and its accessible name. */
export function railIcon(label: string, className = 'seq-icon'): HTMLButtonElement {
  const button = el('button', className) as HTMLButtonElement;
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

/** A 12 px icon drawn from `paths` for a rail button. */
export const railSvg = (paths: string, className = 'seq-icon-svg'): HTMLElement =>
  html('span', className, `<svg viewBox="0 0 12 12" aria-hidden="true">${paths}</svg>`);

/** What the rail's region section does: each action null while it cannot act. */
export interface RailRegion {
  readonly badge: RegionBadge | null;
  readonly split: (() => void) | null;
  readonly remove: (() => void) | null;
}

/** What one device's rail shows. */
export interface RailSpec {
  /** The kind's name, read bottom to top. */
  readonly name: string;
  /** A smaller note after it (Euclid's part name). */
  readonly note?: string | undefined;
  /** The device's own buttons, between the name and the region. */
  readonly tools?: readonly HTMLElement[] | undefined;
  readonly region: RailRegion;
  /** The name's click: fold or unfold the device. */
  readonly fold: () => void;
}

function regionTools(region: RailRegion): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  if (region.badge) {
    const badge = el('span', 'seq-region', region.badge.text);
    badge.title = region.badge.title;
    nodes.push(badge);
  }
  const actions: readonly [string, string, string, (() => void) | null][] = [
    [
      'Split the region in two at its middle bar (alt-click a region to cut it under the pointer)',
      '',
      ICON_SPLIT,
      region.split,
    ],
    ['Delete this region, leaving a rest', ' danger', ICON_DELETE, region.remove],
  ];
  for (const [label, extra, icon, act] of actions) {
    const button = railIcon(label, `seq-icon seq-line-icon${extra}`);
    button.appendChild(railSvg(icon));
    button.disabled = act === null;
    if (act) button.onclick = act;
    nodes.push(button);
  }
  return nodes;
}

/** The rail for one device. */
export function sequencerRail(spec: RailSpec): HTMLElement {
  const rail = el('div', 'seq-rail');
  const dot = el('span', 'seq-dot');
  dot.setAttribute('aria-hidden', 'true');
  const name = el('button', 'seq-name', spec.name) as HTMLButtonElement;
  name.type = 'button';
  name.title = `Fold the ${spec.name} device to its rail, or open it`;
  if (spec.note) name.appendChild(el('span', 'seq-name-part', spec.note));
  name.onclick = spec.fold;
  rail.append(dot, name, el('span', 'seq-rail-spacer'), ...(spec.tools ?? []));
  const region = regionTools(spec.region);
  if (spec.tools?.length) rail.appendChild(el('span', 'seq-rail-gap'));
  rail.append(...region);
  return rail;
}
