import { describe, expect, it } from 'vitest';
import { followShownTab, GEAR_ICON, isPressed, tabFace, type PressedSyncContext } from './tabShell';

describe('tabFace', () => {
  it('shows a plain tab its label as text', () => {
    expect(tabFace({ label: 'Parts' })).toEqual({ kind: 'text', text: 'Parts' });
  });

  it('draws an icon tab and announces its aria label (windsor#39)', () => {
    expect(tabFace({ label: 'Arrangement', icon: GEAR_ICON, ariaLabel: 'Settings' })).toEqual({
      kind: 'icon',
      markup: GEAR_ICON,
      name: 'Settings',
    });
  });

  it('names an icon tab by its label when no aria label is given', () => {
    expect(tabFace({ label: 'Settings', icon: GEAR_ICON })).toMatchObject({ name: 'Settings' });
  });

  it('keeps the gear decorative and in the button colour', () => {
    expect(GEAR_ICON).toContain('aria-hidden="true"');
    expect(GEAR_ICON).toContain('stroke="currentColor"');
  });
});

describe('isPressed (windsor#163)', () => {
  it('presses only the shown tab', () => {
    expect(isPressed('song', 'song')).toBe(true);
    expect(isPressed('mixer', 'song')).toBe(false);
  });

  it('presses nothing before a tab is shown, or for a button without a tab', () => {
    expect(isPressed('song', null)).toBe(false);
    expect(isPressed(undefined, null)).toBe(false);
  });
});

/** A context whose shown tab the test sets, and which keeps its chrome renders. */
function fakeContext(): PressedSyncContext & { renders: (() => void)[]; shown: string | null } {
  const ctx = {
    renders: [] as (() => void)[],
    shown: null as string | null,
    get activeTab(): string | null {
      return ctx.shown;
    },
    addChrome(render: () => void): void {
      ctx.renders.push(render);
    },
  };
  return ctx;
}

describe('followShownTab (windsor#163)', () => {
  it('registers a chrome render that moves the pressed state to the shown tab', () => {
    const ctx = fakeContext();
    ctx.shown = 'song';
    const pressed = new Map<string, boolean>();
    followShownTab(ctx, ['song', 'mixer'], (id, on) => pressed.set(id, on));
    expect(Object.fromEntries(pressed)).toEqual({ song: true, mixer: false });
    expect(ctx.renders).toHaveLength(1);

    // An undo shows its step's tab, then runs every chrome render.
    ctx.shown = 'mixer';
    for (const render of ctx.renders) render();
    expect(Object.fromEntries(pressed)).toEqual({ song: false, mixer: true });
  });

  it('returns the same sync for a click to call', () => {
    const ctx = fakeContext();
    const pressed = new Map<string, boolean>();
    const sync = followShownTab(ctx, ['song', 'mixer'], (id, on) => pressed.set(id, on));
    ctx.shown = 'song';
    sync();
    expect(Object.fromEntries(pressed)).toEqual({ song: true, mixer: false });
  });
});
