import { describe, expect, it } from 'vitest';

import { spaceAction, type SpaceKeyFacts } from './transportKeys';

const space: SpaceKeyFacts = {
  key: ' ',
  repeat: false,
  modified: false,
  editing: false,
  inDialog: false,
};

describe('the space bar toggles the transport (windsor#111)', () => {
  it('plays from stopped', () => {
    expect(spaceAction(space, 'idle')).toBe('play');
  });

  it('pauses while playing, keeping the position', () => {
    expect(spaceAction(space, 'playing')).toBe('pause');
  });

  it('resumes from paused', () => {
    expect(spaceAction(space, 'paused')).toBe('play');
  });

  it('toggles once for a held Space: the repeats are swallowed, not acted on', () => {
    const held = { ...space, repeat: true };
    for (const state of ['idle', 'playing', 'paused'] as const) {
      expect(spaceAction(held, state)).toBe('hold');
    }
  });

  it('leaves Space alone while typing in a field, a select or contenteditable', () => {
    expect(spaceAction({ ...space, editing: true }, 'idle')).toBeNull();
    expect(spaceAction({ ...space, editing: true }, 'playing')).toBeNull();
  });

  it('leaves Space alone inside an open modal dialog', () => {
    expect(spaceAction({ ...space, inDialog: true }, 'idle')).toBeNull();
  });

  it('leaves a shortcut with Ctrl, Meta or Alt to the system', () => {
    expect(spaceAction({ ...space, modified: true }, 'idle')).toBeNull();
  });

  it('ignores every other key, the QWERTY audition keys included', () => {
    for (const key of ['a', 'w', 'z', 'x', 'Enter', 'Spacebar']) {
      expect(spaceAction({ ...space, key }, 'idle')).toBeNull();
    }
  });
});
