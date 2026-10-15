/** The Song tab's M and S (windsor#810; record `2026-10-15-song-tab-mute-solo-keys`). */
import { describe, expect, it } from 'vitest';

import type { StripSwitch } from './songMixerModel';
import type { StripKeyFacts } from './songStripKeys';
import { pressStripKey, stripKeyAction } from './songStripKeys';

const facts = (over: Partial<StripKeyFacts>): StripKeyFacts => ({
  key: '',
  command: false,
  alt: false,
  repeat: false,
  field: false,
  ...over,
});

describe('the strip keys', () => {
  it('names mute on M and solo on S, either case', () => {
    expect(stripKeyAction(facts({ key: 'm' }))).toBe('mute');
    expect(stripKeyAction(facts({ key: 's' }))).toBe('solo');
    expect(stripKeyAction(facts({ key: 'M' }))).toBe('mute');
    expect(stripKeyAction(facts({ key: 'S' }))).toBe('solo');
    expect(stripKeyAction(facts({ key: 'e' }))).toBeNull();
    expect(stripKeyAction(facts({ key: 'd' }))).toBeNull();
  });

  it('leaves Cmd, Ctrl and Alt chords, fields and dialogs alone', () => {
    expect(stripKeyAction(facts({ key: 'm', command: true }))).toBeNull();
    expect(stripKeyAction(facts({ key: 's', alt: true }))).toBeNull();
    expect(stripKeyAction(facts({ key: 's', field: true }))).toBeNull();
  });

  it('acts once on a held key and swallows its repeats', () => {
    const flips: StripSwitch[] = [];
    const target = { toggle: (which: StripSwitch) => flips.push(which) };
    expect(pressStripKey(facts({ key: 'm' }), target)).toBe(true);
    expect(pressStripKey(facts({ key: 'm', repeat: true }), target)).toBe(true);
    expect(pressStripKey(facts({ key: 'm', repeat: true }), target)).toBe(true);
    expect(flips).toEqual(['mute']);
  });

  it('passes the key on with nothing selected or another key', () => {
    const flips: StripSwitch[] = [];
    const target = { toggle: (which: StripSwitch) => flips.push(which) };
    expect(pressStripKey(facts({ key: 's' }), null)).toBe(false);
    expect(pressStripKey(facts({ key: 'x' }), target)).toBe(false);
    expect(pressStripKey(facts({ key: 's', command: true }), target)).toBe(false);
    expect(flips).toEqual([]);
  });
});
