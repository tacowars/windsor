import { describe, expect, it } from 'vitest';
import { SfxSelection } from './sfxSelection';
import { FootstepCadence } from './footstepCadence';

describe('SFX banks', () => {
  it('exhausts each shuffle bag without repeating at its boundary', () => {
    const bank = new SfxSelection(3, 'shuffle', () => 0);
    const values = Array.from({ length: 30 }, () => bank.next());
    for (let i = 1; i < values.length; i++) expect(values[i]).not.toBe(values[i - 1]);
    for (let i = 0; i < values.length; i += 3) expect(new Set(values.slice(i, i + 3)).size).toBe(3);
  });
  it('cycles a round robin and handles a single sample', () => {
    const bank = new SfxSelection(3, 'round-robin');
    expect(Array.from({ length: 5 }, () => bank.next())).toEqual([0, 1, 2, 0, 1]);
    const single = new SfxSelection(1);
    expect([single.next(), single.next()]).toEqual([0, 0]);
    expect(() => new SfxSelection(0)).toThrow();
  });
});

describe('footstep cadence', () => {
  it('uses distance and resets airborne, dead, teleported and absent players', () => {
    const cadence = new FootstepCadence({ strideM: 1, teleportM: 3, maxFrameSeconds: 1 });
    const played: number[] = [];
    const sample = { id: 1, x: 0, y: 0, z: 0, alive: true, grounded: true };
    const update = () => cadence.update([sample], 0.1, (p) => played.push(p.x));
    update();
    sample.x = 1;
    update();
    update();
    expect(played).toEqual([1]);
    sample.grounded = false;
    sample.x = 2;
    update();
    sample.grounded = true;
    update();
    sample.alive = false;
    sample.x = 3;
    update();
    sample.alive = true;
    sample.x = 10;
    update();
    cadence.update([], 0.1, () => {});
    sample.x = 11;
    update();
    expect(played).toEqual([1]);
  });
});
