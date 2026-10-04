/**
 * The Roll's still layers (windsor#602 decisions 3 and 4), drawn from a
 * `RollScene`: the ruler with its bars, the loop brace and the repeat count;
 * the chord strip; the keys; and under the notes, the rows, the bar, beat
 * and snap lines and the repeats' hatch. Nothing here decides anything: the
 * scene and the models did.
 */
import { PPQ } from '@windsor/engine';
import { noteName } from './consoleFormat';
import { el } from './dom';
import { keyFontPx } from './rollNoteLook';
import type { RollPanes } from './rollPanes';
import { isC, keyNamed, pitchClassOf } from './rollRows';
import type { RollScene } from './rollScene';
import { barCount } from './rollScene';
import { repeatsText } from './rollSummary';
import { ROLL_BLACK_PCS, ROLL_PANE_PX, ROLL_SNAP_LINE_MIN_PX } from './rollTables';

const BLACK = new Set(ROLL_BLACK_PCS);

const px = (n: number): string => `${n}px`;

/** A positioned element: `left` and `width` in px. */
function span(className: string, left: number, width: number | null, text = ''): HTMLElement {
  const node = el('span', className, text);
  node.style.left = px(left);
  if (width !== null) node.style.width = px(width);
  return node;
}

/** The playhead's line in one pane. */
const playheadLine = (): HTMLElement => el('span', 'roll-ph');

/** The ruler and the chord strip; returns the chord blocks, in the scene's order, and the playhead. */
export function paintHead(
  panes: RollPanes,
  scene: RollScene,
): { chords: HTMLElement[]; ph: HTMLElement } {
  const { pxPerTick, width } = scene;
  const bar = scene.barTicks * pxPerTick;
  const loopX = scene.loopTicks * pxPerTick;
  panes.headIn.style.width = px(width + ROLL_PANE_PX.overhang);
  const ruler = el('div', 'roll-ruler');
  ruler.style.width = px(width);
  for (let b = 0; b < barCount(scene.regionTicks, scene.barTicks); b++) {
    ruler.appendChild(span('roll-bar-n', b * bar, null, String(b + 1)));
  }
  const brace = span('roll-brace', 0, loopX);
  brace.title = 'The loop';
  ruler.append(brace, span('roll-brace-end', loopX, null));
  const repeats = repeatsText(scene.loopTicks, scene.regionTicks);
  if (repeats) ruler.appendChild(span('roll-repeats', loopX, null, repeats));
  const strip = el('div', 'roll-chords');
  const chords = scene.spans.map((chord) => {
    const block = span(
      `roll-chord${chord.start >= scene.loopTicks ? ' ghosted' : ''}`,
      chord.start * pxPerTick,
      (chord.end - chord.start) * pxPerTick,
      chord.name,
    );
    strip.appendChild(block);
    return block;
  });
  const ph = playheadLine();
  panes.headIn.replaceChildren(ruler, strip, ph);
  return { chords, ph };
}

/** The keys, top down, one per row; each carries its pitch for the guide. */
export function paintKeys(panes: RollPanes, scene: RollScene): HTMLElement[] {
  panes.keysIn.style.height = px(scene.rows.height + ROLL_PANE_PX.overhang);
  const keys = scene.rows.rows.map((row) => {
    const shade = row.thin ? 'thin' : BLACK.has(pitchClassOf(row.pitch)) ? 'b' : 'w';
    const c = isC(row.pitch) && !row.thin ? ' c' : '';
    const out = scene.scalePcs.has(pitchClassOf(row.pitch)) ? '' : ' out-scale';
    const key = el('div', `roll-key ${shade}${c}${out}`, keyNamed(row) ? noteName(row.pitch) : '');
    key.style.top = px(row.top);
    key.style.height = px(row.h);
    key.style.fontSize = px(keyFontPx(row.h));
    key.title = noteName(row.pitch);
    key.dataset.pitch = String(row.pitch);
    return key;
  });
  panes.keysIn.replaceChildren(...keys);
  return keys;
}

/** The bar, beat and snap lines as one layer of gradients. */
function lines(scene: RollScene): HTMLElement {
  const layer = el('div', 'roll-lines');
  const { pxPerTick } = scene;
  const grads = ['var(--line-bright)', 'var(--roll-beat-line)'];
  const sizes = [scene.barTicks * pxPerTick, PPQ * pxPerTick];
  const snapPx = scene.snapTicks * pxPerTick;
  if (snapPx >= ROLL_SNAP_LINE_MIN_PX && scene.snapTicks < PPQ) {
    grads.push('var(--roll-snap-line)');
    sizes.push(snapPx);
  }
  layer.style.backgroundImage = grads
    .map((colour) => `linear-gradient(to right, ${colour} 1px, transparent 1px)`)
    .join(',');
  layer.style.backgroundSize = sizes.map((size) => `${size}px 100%`).join(',');
  return layer;
}

/** The rows, the lines and the hatch past the loop; returns the notes' layer and the playhead. */
export function paintBody(
  panes: RollPanes,
  scene: RollScene,
): { notes: HTMLElement; ph: HTMLElement } {
  const { width } = scene;
  panes.canvas.style.width = px(width);
  panes.canvas.style.height = px(scene.rows.height);
  const rows = scene.rows.rows.map((row) => {
    const shade = row.thin ? 'thin' : BLACK.has(pitchClassOf(row.pitch)) ? 'b' : 'w';
    const sep = row.thin ? '' : isC(row.pitch) ? ' csep' : ' sep';
    const node = el('div', `roll-row ${shade}${sep}`);
    node.style.top = px(row.top);
    node.style.height = px(row.h);
    node.style.width = px(width);
    return node;
  });
  const layers: HTMLElement[] = [...rows, lines(scene)];
  const loopX = scene.loopTicks * scene.pxPerTick;
  if (scene.loopTicks < scene.regionTicks) {
    layers.push(span('roll-hatch', loopX, width - loopX));
  }
  const notes = el('div', 'roll-notes');
  const ph = playheadLine();
  panes.canvas.replaceChildren(...layers, notes, ph);
  return { notes, ph };
}
