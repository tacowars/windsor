/**
 * The Euclid card's stack of rows (windsor#356, decisions 3–6 of the issue):
 * the ratchet row directly over the trigger row, then the Lanes rule and a
 * row per lane (`euclidLaneRows.ts`).
 *
 * - **Ratchet**: one thin cell per trigger step drawing its roll's `N`
 *   ticks; a click cycles ×1 → ×2 → ×3 → ×4 → ×1. A cell over a rest is
 *   grey: it waits for a hit to land there.
 * - **Trigger**: the figure strip as it was: the hits, the playhead ring, a
 *   click to flip a step (which captures the figure) and Release.
 *
 * Since windsor#393 the ratchet row, the trigger row and the Lanes rule are
 * held at the top of the device's one rows scroller while the lanes scroll
 * under them, and each cell's reading is its tooltip. The rule is the
 * Pattern page's, built once with its + Lane picker: a rebuild puts the
 * rows either side of it and never moves it, so an open picker stays open.
 *
 * The rows are built whole from the document and the player's figure; the
 * card rebuilds them when what they show changes and lights each row's
 * playhead every frame (`RowHead`). A control focused before a rebuild is
 * focused again after it (`euclidRowFocus.ts`, windsor#383), so a second
 * key press edits on.
 */
import type { EuclideanSpec } from '@windsor/engine';
import { el } from './dom';
import type { EuclidCard } from './euclidCardState';
import { cycleRatchet, ratchetAt } from './euclidRatchetModel';
import { laneRows } from './euclidLaneRows';
import { type LaneView, triggerHead } from './euclidLaneView';
import { type Figure, countOnsets, toggleStep } from './euclidModel';
import { type FocusAddress, ROW_KEY_ATTRIBUTE, focusAddress, nodeAt } from './euclidRowFocus';
import { type RowHead, cellStrip, nameButton, row, rowName } from './euclidRowParts';

/** What the rows are drawn from, as of one build. */
export interface RowsInput {
  readonly card: EuclidCard;
  readonly spec: EuclideanSpec;
  readonly figure: Figure;
  readonly view: LaneView;
  readonly pass: number;
  readonly group: number;
}

function ratchetText(step: number, roll: number, hit: boolean): string {
  return `Ratchet · step ${step + 1} · ×${roll}${hit ? '' : ' · waits for a hit'}`;
}

function ratchetRow(input: RowsInput): RowHead & { row: HTMLElement } {
  const { card, spec, figure } = input;
  const cells = cellStrip(spec.steps, input.group, (i) => {
    const roll = ratchetAt(spec.ratchets, i);
    const hit = figure[i] === true;
    const cell = el('button', `ecell euclid-ratchet r${roll}`) as HTMLButtonElement;
    cell.type = 'button';
    cell.classList.toggle('idle', !hit);
    const ticks = el('span', 'euclid-ticks');
    for (let t = 0; t < roll; t++) ticks.appendChild(el('i'));
    cell.appendChild(ticks);
    cell.setAttribute('aria-label', `Ratchet step ${i + 1}: times ${roll}`);
    cell.title = ratchetText(i, roll, hit);
    cell.onclick = (): void => {
      const now = card.spec();
      if (now) card.write({ ratchets: cycleRatchet(now.ratchets, now.steps, i) });
    };
    return cell;
  });
  const node = row('euclid-row-ratchet', rowName('Ratchet', ''), cells);
  return { row: node, cells, head: triggerHead };
}

/** The trigger row's small line: `E(7,16) rot 2`, or `captured · 7/16`. */
export function triggerSub(spec: EuclideanSpec, figure: Figure): string {
  const k = countOnsets(figure);
  if (spec.pattern) return `captured · ${k}/${figure.length}`;
  return `E(${k},${figure.length})${spec.rotate ? ` rot ${spec.rotate}` : ''}`;
}

function triggerRow(input: RowsInput): RowHead & { row: HTMLElement } {
  const { card, spec, figure } = input;
  const cells = cellStrip(figure.length, input.group, (i) => {
    const hit = figure[i] === true;
    const cell = el('button', 'ecell') as HTMLButtonElement;
    cell.type = 'button';
    cell.classList.toggle('on', hit);
    cell.setAttribute('aria-pressed', String(hit));
    cell.setAttribute('aria-label', `Trigger step ${i + 1}: ${hit ? 'hit' : 'rest'}`);
    cell.title = `Trigger · step ${i + 1} of ${figure.length} · ${hit ? 'hit' : 'rest'}`;
    cell.onclick = (): void => card.capture(toggleStep(card.figure(), i));
    return cell;
  });
  const controls: HTMLElement[] = [];
  if (spec.pattern) {
    const release = nameButton('Release', 'Release: the modulator moves k again', 'euclid-release');
    release.onclick = (): void => card.capture(null);
    controls.push(release);
  }
  const node = row(
    'euclid-row-trigger',
    rowName('Trigger', triggerSub(spec, figure), ...controls),
    cells,
  );
  return { row: node, cells, head: triggerHead };
}

/** Put focus back on the control at `focus` in the rebuilt rows, without scrolling to it. */
function refocus(scope: HTMLElement, focus: FocusAddress): void {
  const node = nodeAt(scope, focus);
  if (node instanceof HTMLElement) node.focus({ preventScroll: true });
}

/**
 * Fill `scope` with every row either side of the Lanes `rule`, which stays
 * where it is, and return the playheads the loop lights.
 */
export function paintRows(scope: HTMLElement, rule: HTMLElement, input: RowsInput): RowHead[] {
  const ratchet = ratchetRow(input);
  const trigger = triggerRow(input);
  const lanes = laneRows({ ...input, scope });
  ratchet.row.setAttribute(ROW_KEY_ATTRIBUTE, 'ratchet');
  trigger.row.setAttribute(ROW_KEY_ATTRIBUTE, 'trigger');
  const focus = focusAddress(scope, document.activeElement);
  for (const child of Array.from(scope.children)) if (child !== rule) child.remove();
  if (rule.parentElement !== scope) scope.appendChild(rule);
  rule.before(ratchet.row, trigger.row);
  rule.after(...lanes.rows);
  if (focus) refocus(scope, focus);
  return [ratchet, trigger, ...lanes.heads];
}
