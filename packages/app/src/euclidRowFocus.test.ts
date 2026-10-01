/**
 * Keyboard focus across a rebuild of the Euclid card's rows (windsor#383,
 * decision 2): two presses on one pitch cell or one ratchet, with the rows
 * rebuilt from the document between them, edit the same cell twice, and a
 * sound lane's cell is found again by its row's key when the rows above it
 * change. The rows are plain objects shaped as `paintRows` builds them: a
 * row is its name column and its strip of cells.
 */
import { describe, expect, it } from 'vitest';

import { cycleRatchet, ratchetAt } from './euclidRatchetModel';
import {
  type FocusAddress,
  ROW_KEY_ATTRIBUTE,
  type RowNode,
  focusAddress,
  nodeAt,
} from './euclidRowFocus';

class Node implements RowNode {
  parentElement: Node | null = null;
  readonly children: Node[] = [];
  constructor(
    readonly attrs: Record<string, string> = {},
    readonly value = 0,
  ) {}
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  append(...nodes: Node[]): this {
    for (const n of nodes) {
      n.parentElement = this;
      this.children.push(n);
    }
    return this;
  }
}

interface Rows {
  readonly ratchets: readonly number[];
  readonly pitch: readonly number[];
  readonly sounds: readonly string[];
}

/** A row as `euclidRows.ts` lays it out: the key, the name column, the cells holding `values`. */
const row = (key: string, values: readonly number[]): Node =>
  new Node({ [ROW_KEY_ATTRIBUTE]: key }).append(
    new Node(),
    new Node().append(...values.map((v) => new Node({}, v))),
  );

/** The whole stack, rebuilt from the document as the card's repaint does: a new tree each time. */
function paint(rows: Rows): Node {
  return new Node().append(
    row('ratchet', rows.ratchets),
    row('trigger', [1, 0, 0, 1]),
    new Node(),
    row('pitch', rows.pitch),
    ...rows.sounds.map((param) => row(`sound:${param}`, [0, 0, 0, 0])),
  );
}

/** One key press on the focused node, then the repaint it brings; returns the document and the new focus. */
function press(
  rows: Rows,
  scope: Node,
  focused: Node,
  edit: (rows: Rows, cell: number, value: number) => Rows,
): { rows: Rows; scope: Node; focused: Node | null } {
  const cell = focused.parentElement?.children.indexOf(focused) ?? -1;
  const next = edit(rows, cell, focused.value);
  const address = focusAddress(scope, focused);
  const repainted = paint(next);
  return {
    rows: next,
    scope: repainted,
    focused: address && (nodeAt(repainted, address) as Node | null),
  };
}

const ROWS: Rows = { ratchets: [1, 1, 1, 1], pitch: [0, 0, 0, 0], sounds: ['cutoff', 'pan'] };
const cellOf = (scope: Node, rowIndex: number, cell: number): Node =>
  scope.children[rowIndex]!.children[1]!.children[cell]!;

const arrowUp = (rows: Rows, cell: number, value: number): Rows => ({
  ...rows,
  pitch: rows.pitch.map((v, i) => (i === cell ? value + 1 : v)),
});
const cycle = (rows: Rows, cell: number): Rows => ({
  ...rows,
  ratchets: cycleRatchet(rows.ratchets, rows.ratchets.length, cell),
});

describe('focus across a rebuild of the rows', () => {
  it('two ArrowUp presses on one pitch cell raise it by 2', () => {
    const scope = paint(ROWS);
    const first = press(ROWS, scope, cellOf(scope, 3, 2), arrowUp);
    expect(first.focused?.value).toBe(1);
    const second = press(first.rows, first.scope, first.focused!, arrowUp);
    expect(second.rows.pitch).toEqual([0, 0, 2, 0]);
    expect(second.focused).toBe(cellOf(second.scope, 3, 2));
  });

  it('two presses on one ratchet cycle it twice', () => {
    const scope = paint(ROWS);
    const first = press(ROWS, scope, cellOf(scope, 0, 1), cycle);
    const second = press(first.rows, first.scope, first.focused!, cycle);
    expect(ratchetAt(second.rows.ratchets, 1)).toBe(3);
    expect(second.focused).toBe(cellOf(second.scope, 0, 1));
  });

  it("finds a sound lane's cell by its row's key when a lane above it goes", () => {
    const scope = paint(ROWS);
    const address = focusAddress(scope, cellOf(scope, 5, 3)) as FocusAddress;
    expect(address).toEqual({ row: 'sound:pan', path: [1, 3] });
    const repainted = paint({ ...ROWS, sounds: ['pan'] });
    expect(nodeAt(repainted, address)).toBe(cellOf(repainted, 4, 3));
  });

  it('leaves focus alone when the row or the cell is gone', () => {
    const scope = paint(ROWS);
    const pan = focusAddress(scope, cellOf(scope, 5, 3)) as FocusAddress;
    expect(nodeAt(paint({ ...ROWS, sounds: ['cutoff'] }), pan)).toBeNull();
    const pitch = focusAddress(scope, cellOf(scope, 3, 3)) as FocusAddress;
    expect(nodeAt(paint({ ...ROWS, pitch: [0, 0] }), pitch)).toBeNull();
  });

  it('has no address outside the rows, or in the unkeyed rule', () => {
    const scope = paint(ROWS);
    expect(focusAddress(scope, new Node())).toBeNull();
    expect(focusAddress(scope, null)).toBeNull();
    expect(focusAddress(scope, scope.children[2]!)).toBeNull();
  });
});
