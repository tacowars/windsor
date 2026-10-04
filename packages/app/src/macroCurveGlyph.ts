/**
 * A Macros card mapping row's curve glyph (windsor#561, the mockup
 * `docs/design/macro-knobs-mockup.html`): its two axes and its shape, drawn
 * from `CURVE_GLYPH_PATHS`. Split from `macroCard.ts` (windsor#568).
 */
import { MACRO_CURVE_NAMES } from '@windsor/engine';
import { CURVE_GLYPH_BOX, CURVE_GLYPH_PATHS } from './macroTables';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(tag: string, attrs: Readonly<Record<string, string | number>>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

/** A curve's glyph: its two axes and its shape, mirrored when the mapping is inverted. */
export function curveGlyph(curve: number, inverted: boolean): SVGElement {
  const { w, h, inset } = CURVE_GLYPH_BOX;
  const svg = svgNode('svg', { class: 'glyph', viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
  const name = MACRO_CURVE_NAMES[curve] ?? MACRO_CURVE_NAMES[0];
  svg.append(
    svgNode('line', { x1: inset, y1: h - inset, x2: w - inset, y2: h - inset }),
    svgNode('line', { x1: inset, y1: inset, x2: inset, y2: h - inset }),
    svgNode('path', {
      d: CURVE_GLYPH_PATHS[name],
      ...(inverted ? { transform: `translate(${w} 0) scale(-1 1)` } : {}),
    }),
  );
  return svg;
}
