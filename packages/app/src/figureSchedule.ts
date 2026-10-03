/**
 * The Figure's Schedule chips (windsor#490; the mockup's Process page): one
 * chip per stage, `length × bars`. Drag a chip by its grip to reorder it,
 * drag a number up or down (or press an arrow key on it) to change it, ×
 * to remove the stage, + to add one, a cell longer than the last. The stage
 * in play is outlined. Every edit writes the whole schedule once, on
 * release, through the host; the rules are `figureProcessModel.ts`.
 */
import type { FigureStage } from '@windsor/engine';
import { el } from './dom';
import { capturePointer } from './figureCells';
import { FIGURE_CHIP_DRAG_PX } from './figureConstants';
import { addStage, moveStage, removeStage, setStage } from './figureProcessModel';

/** What the chips read and write. */
export interface ScheduleHost {
  /** The schedule as the document holds it (empty for none) and the line's cell count. */
  read(): { stages: readonly FigureStage[]; cells: number };
  /** Write the whole schedule; empty means every cell plays. */
  write(stages: readonly FigureStage[]): void;
}

/** The chips row and its per-frame paint. */
export interface ScheduleChips {
  readonly root: HTMLElement;
  /** Rebuild when the schedule changed, and outline stage `now` (-1 for none). */
  paint(now: number): void;
}

/** A number on a chip: a vertical drag or an arrow key changes it, written on release. */
function chipNumber(host: ScheduleHost, index: number, field: keyof FigureStage): HTMLElement {
  const { stages, cells } = host.read();
  const value = stages[index]?.[field] ?? 1;
  const node = el('button', 'figure-chip-num', String(value)) as HTMLButtonElement;
  node.type = 'button';
  node.title = `${field === 'length' ? 'Cells' : 'Bars'}: drag up or down, or the arrow keys`;
  node.setAttribute('aria-label', `Stage ${index + 1} ${field}`);
  const commit = (next: number): void => {
    if (next !== value) host.write(setStage(host.read().stages, index, field, next, cells));
  };
  let press: { id: number; y: number; next: number } | null = null;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    press = { id: e.pointerId, y: e.clientY, next: value };
    capturePointer(node, e.pointerId);
  });
  node.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const shown = setStage(
      stages,
      index,
      field,
      value - Math.round((e.clientY - press.y) / FIGURE_CHIP_DRAG_PX),
      cells,
    );
    press.next = shown[index]?.[field] ?? value;
    node.textContent = String(press.next);
  });
  node.addEventListener('pointerup', () => {
    const done = press;
    press = null;
    if (done) commit(done.next);
  });
  node.addEventListener('pointercancel', () => {
    press = null;
    node.textContent = String(value);
  });
  node.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    commit(value + step);
  });
  return node;
}

/** The chip index under the pointer, or the nearest chip's. */
function chipAt(row: HTMLElement, x: number, y: number): number {
  const chips = [...row.querySelectorAll<HTMLElement>('.figure-chip:not(.add)')];
  let best = -1;
  let bestDistance = Infinity;
  chips.forEach((chip, i) => {
    const box = chip.getBoundingClientRect();
    const distance = Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2));
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/** The grip: a drag moves the chip to where it is let go, written on release. */
function grip(host: ScheduleHost, row: HTMLElement, index: number): HTMLElement {
  const node = el('span', 'figure-grip', '⋮⋮');
  node.title = 'Drag to reorder';
  let target = index;
  let live = false;
  const mark = (on: number): void => {
    row.querySelectorAll('.figure-chip').forEach((chip, i) => {
      chip.classList.toggle('figure-chip-target', live && i === on && on !== index);
    });
  };
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    live = true;
    target = index;
    capturePointer(node, e.pointerId);
  });
  node.addEventListener('pointermove', (e) => {
    if (!live) return;
    target = chipAt(row, e.clientX, e.clientY);
    mark(target);
  });
  node.addEventListener('pointerup', () => {
    if (!live) return;
    live = false;
    mark(-1);
    if (target >= 0 && target !== index) host.write(moveStage(host.read().stages, index, target));
  });
  node.addEventListener('pointercancel', () => {
    live = false;
    mark(-1);
  });
  return node;
}

function chip(
  host: ScheduleHost,
  row: HTMLElement,
  index: number,
  stage: FigureStage,
): HTMLElement {
  const node = el('span', 'figure-chip');
  node.title = `Stage ${index + 1}: ${stage.length} cells for ${stage.bars} bars`;
  const remove = el('button', 'figure-chip-x', '×') as HTMLButtonElement;
  remove.type = 'button';
  remove.title = 'Remove this stage';
  remove.setAttribute('aria-label', `Remove stage ${index + 1}`);
  remove.onclick = (): void => host.write(removeStage(host.read().stages, index));
  node.append(
    grip(host, row, index),
    chipNumber(host, index, 'length'),
    el('span', 'figure-chip-by', '×'),
    chipNumber(host, index, 'bars'),
    remove,
  );
  return node;
}

/** The chips row over `host`. */
export function scheduleChips(host: ScheduleHost): ScheduleChips {
  const row = el('div', 'figure-chips');
  let drawn = '';
  const rebuild = (): void => {
    const { stages, cells } = host.read();
    row.replaceChildren(...stages.map((stage, i) => chip(host, row, i, stage)));
    const add = el('button', 'figure-chip add', '+') as HTMLButtonElement;
    add.type = 'button';
    add.title = 'Add a stage: one cell longer than the last';
    add.setAttribute('aria-label', 'Add a stage');
    add.onclick = (): void => host.write(addStage(host.read().stages, cells));
    row.appendChild(add);
  };
  return {
    root: row,
    paint: (now) => {
      const { stages, cells } = host.read();
      const key = JSON.stringify([stages, cells]);
      if (key !== drawn) {
        drawn = key;
        rebuild();
      }
      row.querySelectorAll('.figure-chip:not(.add)').forEach((node, i) => {
        node.classList.toggle('now', i === now);
      });
    },
  };
}
