import { describe, expect, it } from 'vitest';

import { tabKeyAction, type TabKeyFacts } from './tabKeys';

const tab: TabKeyFacts = {
  key: 'Tab',
  shift: false,
  repeat: false,
  modified: false,
  inDialog: false,
};
const shiftTab: TabKeyFacts = { ...tab, shift: true };
const to = (id: string): { kind: 'switch'; tab: string } => ({ kind: 'switch', tab: id });

describe('Tab switches between Parts, Mixer and Song (windsor#480)', () => {
  it('cycles Parts, Mixer, Song and back to Parts', () => {
    expect(tabKeyAction(tab, 'parts')).toEqual(to('mixer'));
    expect(tabKeyAction(tab, 'mixer')).toEqual(to('song'));
    expect(tabKeyAction(tab, 'song')).toEqual(to('parts'));
  });

  it('goes the other way with Shift+Tab', () => {
    expect(tabKeyAction(shiftTab, 'parts')).toEqual(to('song'));
    expect(tabKeyAction(shiftTab, 'song')).toEqual(to('mixer'));
    expect(tabKeyAction(shiftTab, 'mixer')).toEqual(to('parts'));
  });

  it('leaves Settings for Parts, or Song with Shift, and never lands on it', () => {
    expect(tabKeyAction(tab, 'arrangement')).toEqual(to('parts'));
    expect(tabKeyAction(shiftTab, 'arrangement')).toEqual(to('song'));
  });

  it('leaves a Tab with Ctrl, Cmd or Alt to the browser and the OS', () => {
    expect(tabKeyAction({ ...tab, modified: true }, 'parts')).toBeNull();
    expect(tabKeyAction({ ...shiftTab, modified: true }, 'parts')).toBeNull();
  });

  it('switches once for a held Tab: the repeats are swallowed', () => {
    expect(tabKeyAction({ ...tab, repeat: true }, 'parts')).toEqual({ kind: 'swallow' });
  });

  it('swallows Tab and Shift+Tab in an open modal, switching nothing', () => {
    expect(tabKeyAction({ ...tab, inDialog: true }, 'parts')).toEqual({ kind: 'swallow' });
    expect(tabKeyAction({ ...shiftTab, inDialog: true }, 'mixer')).toEqual({ kind: 'swallow' });
  });

  it('leaves every other key alone', () => {
    expect(tabKeyAction({ ...tab, key: ' ' }, 'parts')).toBeNull();
  });
});
