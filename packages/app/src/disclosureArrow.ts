/**
 * The Song tab's one fold arrow (windsor#768 decision 1; record
 * `2026-10-12-song-mixer-arrows-and-value-bubbles`): an SVG triangle, not a
 * font character, so it fills its box in every face and browser. The part
 * fold, the group's two folds and the mixer header's toggle all draw it.
 *
 * The arrow points right while closed and turns 90° to point down while its
 * button's `aria-expanded` is true (`console.css`'s `.disclosure` rules, a
 * 120 ms transition, none under `prefers-reduced-motion`). Every fold
 * repaints the lanes, so the button a press leaves focused is a new one;
 * `turnDisclosure` starts it from the old angle, so the turn still plays.
 */
import {
  DISCLOSURE_ARROW_PX,
  DISCLOSURE_TRIANGLE_PATH,
  DISCLOSURE_VIEWBOX,
} from './disclosureArrowTables';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Where an arrow sits, which sets its size. */
export type DisclosurePlace = keyof typeof DISCLOSURE_ARROW_PX;

/** The triangle, `DISCLOSURE_ARROW_PX[place]` px square, hidden from assistive tech. */
export function disclosureArrow(place: DisclosurePlace): SVGSVGElement {
  const px = String(DISCLOSURE_ARROW_PX[place]);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'disclosure-arrow');
  svg.setAttribute('width', px);
  svg.setAttribute('height', px);
  svg.setAttribute('viewBox', `0 0 ${DISCLOSURE_VIEWBOX} ${DISCLOSURE_VIEWBOX}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', DISCLOSURE_TRIANGLE_PATH);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

/**
 * Play the turn on `button`, a fold just rebuilt in its new state: its
 * arrow is set back to the angle it had before the press, then let go, so
 * the stylesheet's transition carries it to the new one.
 */
export function turnDisclosure(button: Element | null): void {
  const arrow = button?.querySelector<SVGSVGElement>('.disclosure-arrow');
  if (!button || !arrow) return;
  const open = button.getAttribute('aria-expanded') === 'true';
  arrow.style.transition = 'none';
  arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
  // Read layout once, so the old angle is applied before it is released.
  arrow.getBoundingClientRect();
  arrow.style.transition = '';
  arrow.style.transform = '';
}
