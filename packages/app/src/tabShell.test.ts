import { describe, expect, it } from 'vitest';
import { GEAR_ICON, isPressed, tabFace } from './tabShell';

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
