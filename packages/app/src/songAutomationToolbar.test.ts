/**
 * The lane toolbar's keys (windsor#349 decision 6): E and D pick the tools on
 * a plain press, and a modified press is left to the browser.
 */
import { describe, expect, it } from 'vitest';
import { AUTOMATION_TOOLS } from './songAutomationTables';
import { toolForKey } from './songAutomationToolbar';

const press = (
  key: string,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  ...mods,
});

describe('toolForKey', () => {
  it('picks Edit on E and Draw on D, either case', () => {
    expect(toolForKey(press('e'))).toBe('edit');
    expect(toolForKey(press('D'))).toBe('draw');
  });

  it('leaves other keys and modified presses alone', () => {
    expect(toolForKey(press('s'))).toBeNull();
    expect(toolForKey(press('e', { metaKey: true }))).toBeNull();
    expect(toolForKey(press('d', { ctrlKey: true }))).toBeNull();
    expect(toolForKey(press('e', { altKey: true }))).toBeNull();
  });

  it('gives every tool its own key', () => {
    const keys = AUTOMATION_TOOLS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
