import { describe, expect, it } from 'vitest';

import type { OpSync } from '@windsor/engine';
import { syncFaceText, syncFaceTitle, syncMenuHeading, syncMenuItems } from './operatorSyncMenu';

const FREE: OpSync[] = ['off', 'off', 'off', 'off'];
/** B → A. */
const B_TO_A: OpSync[] = ['off', 'A', 'off', 'off'];
/** C → B → A. */
const C_B_A: OpSync[] = ['off', 'A', 'B', 'off'];

const byValue = (syncs: OpSync[], i: number, value: OpSync) =>
  syncMenuItems(syncs, i).find((item) => item.value === value);

describe('the Sync menu', () => {
  it('lists Off, Note and the other three operators, never its own, in the mockup words', () => {
    expect(syncMenuHeading(0)).toBe('A syncs to');
    expect(syncMenuItems(FREE, 0).map((item) => [item.glyph, item.label, item.hint])).toEqual([
      ['–', 'Off', 'Runs free, as today'],
      ['♪', 'Note', "Restarts on every cycle of the note's pitch"],
      ['B', 'Operator B', 'Restarts on every cycle of B'],
      ['C', 'Operator C', 'Restarts on every cycle of C'],
      ['D', 'Operator D', 'Restarts on every cycle of D'],
    ]);
    for (let i = 0; i < 4; i++) {
      const values = syncMenuItems(FREE, i).map((item) => item.value);
      expect(values).toHaveLength(5);
      expect(values).not.toContain(['A', 'B', 'C', 'D'][i]);
    }
  });

  it('checks the current choice only', () => {
    const checked = syncMenuItems(B_TO_A, 1).filter((item) => item.checked);
    expect(checked.map((item) => item.value)).toEqual(['A']);
    expect(syncMenuItems(FREE, 2).filter((item) => item.checked)[0]?.value).toBe('off');
  });

  it('disables a letter that would close a loop, with the path that closes it', () => {
    const b = byValue(B_TO_A, 0, 'B');
    expect(b?.disabled).toBe(true);
    expect(b?.hint).toBe('B → A already, so A → B would close a loop');
    expect(byValue(B_TO_A, 0, 'C')?.disabled).toBe(false);

    expect(byValue(C_B_A, 0, 'B')?.disabled).toBe(true);
    const c = byValue(C_B_A, 0, 'C');
    expect(c?.disabled).toBe(true);
    expect(c?.hint).toBe('C → B → A already, so A → C would close a loop');
    expect(byValue(C_B_A, 0, 'D')?.disabled).toBe(false);
    expect(byValue(C_B_A, 1, 'C')?.hint).toBe('C → B already, so B → C would close a loop');
  });

  it('never disables Off or Note', () => {
    for (const item of syncMenuItems(C_B_A, 0).slice(0, 2)) expect(item.disabled).toBe(false);
  });
});

describe('the Sync face', () => {
  it('reads Sync while off, ♪ for the note and the master letter otherwise', () => {
    expect(['off', 'note', 'C'].map((v) => syncFaceText(v as OpSync))).toEqual(['Sync', '♪', 'C']);
  });

  it('titles what restarts the operator', () => {
    expect(syncFaceTitle(FREE, 0)).toBe('Sync: off');
    expect(syncFaceTitle(['note', 'off', 'off', 'off'], 0)).toBe(
      'Sync: A restarts on every cycle of the note',
    );
    expect(syncFaceTitle(B_TO_A, 1)).toBe('Sync: B restarts on every cycle of A');
  });
});
