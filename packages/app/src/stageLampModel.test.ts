/**
 * The stage lamp (windsor#194 decision 5): lit within the hold, red while
 * latched, and named by the latching report rather than the mode in force.
 */
import { describe, expect, it } from 'vitest';

import { stageLampView } from './stageLampModel';
import { OUTPUT_LIGHT_HOLD_MS } from './outputStageTables';

describe('stageLampView', () => {
  it('is dark and names the mode’s action with no live stage', () => {
    expect(stageLampView('limiter', null, 5000)).toMatchObject({
      lit: false,
      latched: false,
      label: 'Limiting',
    });
    expect(stageLampView('soft', null, 0).label).toBe('Clipping');
    expect(stageLampView('hard', null, 0).label).toBe('Clipping');
    expect(stageLampView('off', null, 0).label).toBe('Over 0 dB');
  });

  it('is lit within the hold after the stage acted, and not after', () => {
    const watch = { latchedAction: null, lastActedMs: 1000 };
    expect(stageLampView('limiter', watch, 1000 + OUTPUT_LIGHT_HOLD_MS - 1).lit).toBe(true);
    expect(stageLampView('limiter', watch, 1000 + OUTPUT_LIGHT_HOLD_MS).lit).toBe(false);
  });

  it('keeps the latched action’s name after a mode change, until cleared', () => {
    const latched = { latchedAction: 'Limiting' as const, lastActedMs: 0 };
    const view = stageLampView('soft', latched, 10_000);
    expect(view).toMatchObject({ lit: false, latched: true, label: 'Limiting' });
    expect(view.title).toBe('Limiting since the last clear. Click to clear the lamp.');
    const cleared = stageLampView('soft', { latchedAction: null, lastActedMs: 0 }, 10_000);
    expect(cleared).toMatchObject({ latched: false, label: 'Clipping' });
  });

  it('says in its title what the lamp does unlatched', () => {
    expect(stageLampView('off', null, 0).title).toBe(
      'Lights when a sample goes over 0 dBFS, and stays red until clicked.',
    );
  });
});
