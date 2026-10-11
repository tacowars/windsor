/**
 * The layer the Envelopes tab lays over the note pane (windsor#707 decision
 * 6; the approved mockup's `.renv-layer`): the dashed 0 line with its +1, 0
 * and −1 marks, fixed to the pane, and the shown envelope's curve
 * (`rollEnvelopeGeometry.ts`) across the loop, ghosted over the repeats,
 * which follows the notes' sideways scroll. The layer covers the note pane,
 * so the notes under it take no pointer while it shows.
 */
import type { RollEnvelope } from '@windsor/engine';
import { el } from './dom';
import { envelopeGeometry, envelopeY } from './rollEnvelopeGeometry';
import { ROLL_ENVELOPE_DRAW } from './rollEnvelopeTables';
import type { RollScene } from './rollScene';
import { AUTOMATION_DRAWING, type AutomationTool } from './songAutomationTables';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(tag: string, attrs: Readonly<Record<string, string | number>>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

/** What one paint of the layer draws. */
export interface EnvelopeLayerPaint {
  readonly envelope: RollEnvelope | null;
  readonly scene: RollScene;
  readonly tool: AutomationTool;
  /** The note pane's visible size, and where it is scrolled to. */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly scrollLeft: number;
}

/** The layer, its paint and its scroll. */
export interface EnvelopeLayer {
  readonly root: HTMLElement;
  paint(input: EnvelopeLayerPaint): void;
  scroll(scrollLeft: number): void;
}

/** The 0 line and the scale's marks, at the pane's right edge. */
function scaleMarks(widthPx: number, heightPx: number): SVGElement {
  const D = ROLL_ENVELOPE_DRAW;
  const box = svgNode('svg', { width: widthPx, height: heightPx, 'aria-hidden': 'true' });
  const zero = envelopeY(0, heightPx);
  box.appendChild(svgNode('line', { class: 'renv-zero', x1: 0, x2: widthPx, y1: zero, y2: zero }));
  const x = widthPx - D.scaleInsetPx;
  const marks: [string, number][] = [
    [D.scale.top, AUTOMATION_DRAWING.padPx + D.scaleTopPx],
    [D.scale.zero, zero - D.scaleLiftPx],
    [D.scale.bottom, heightPx - AUTOMATION_DRAWING.padPx - 1],
  ];
  for (const [text, y] of marks) {
    const mark = svgNode('text', { class: 'renv-scale', x, y, 'text-anchor': 'end' });
    mark.textContent = text;
    box.appendChild(mark);
  }
  return box;
}

/** The envelope's curve across the region, each pass clipped to its loop: the first live with its dots, the rest ghosts. */
function curve(envelope: RollEnvelope, scene: RollScene, heightPx: number): SVGElement {
  const geometry = envelopeGeometry(envelope.points, {
    heightPx,
    pxPerTick: scene.pxPerTick,
    loopTicks: scene.loopTicks,
    regionTicks: scene.regionTicks,
  });
  const box = svgNode('svg', { class: 'renv-curve', width: scene.width, height: heightPx });
  box.setAttribute('aria-hidden', 'true');
  const all = svgNode('g', envelope.on ? {} : { class: 'renv-off' });
  for (const pass of geometry.passes) {
    const frame = svgNode('svg', { x: pass.x, y: 0, width: pass.width, height: heightPx });
    const group = svgNode('g', pass.ghost ? { class: 'renv-ghost' } : {});
    group.append(
      svgNode('path', { class: 'auto-fill', d: geometry.curve.area }),
      svgNode('path', { class: 'auto-line', d: geometry.curve.line }),
    );
    frame.appendChild(group);
    all.appendChild(frame);
  }
  // The dots on the live pass, outside its clip so a point on the loop's edge shows whole.
  const r = AUTOMATION_DRAWING.dotRadiusPx;
  for (const dot of geometry.curve.dots) {
    all.appendChild(svgNode('circle', { class: 'auto-dot', cx: dot.x, cy: dot.y, r }));
  }
  box.appendChild(all);
  return box;
}

/** The empty layer; hidden until the Envelopes tab shows it. */
export function envelopeLayer(): EnvelopeLayer {
  const root = el('div', 'renv-layer');
  root.hidden = true;
  let drawn: SVGElement | null = null;
  const scroll = (scrollLeft: number): void => {
    if (drawn) drawn.style.transform = `translateX(${-scrollLeft}px)`;
  };
  return {
    root,
    scroll,
    paint: (input) => {
      const { envelope, scene, widthPx, heightPx } = input;
      root.dataset['tool'] = input.tool;
      drawn = envelope ? curve(envelope, scene, heightPx) : null;
      root.replaceChildren(scaleMarks(widthPx, heightPx), ...(drawn ? [drawn] : []));
      scroll(input.scrollLeft);
    },
  };
}
