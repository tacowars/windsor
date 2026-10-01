/**
 * The drive's switch (windsor#309): `drive.on` is additive. A patch or song
 * that omits it takes `driveOnByDefault` of its own gain and bias, so it
 * plays as it did and shows the truth: the library's driven drums read On,
 * a patch at unity gain with no bias reads Off. A switch that is written
 * survives `makePatch`, a merge and a song's export and import. That Off
 * renders as no drive at all is `synth/fmProcessorDrive.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { KICK, song } from '../__fixtures__/documentCases';
import { makeArrangement } from '../song/arrangementDocument';
import { driveOnByDefault, makePatch, mergePatch } from './patch';
import type { PartialPatch } from './patch';
import { PRESETS } from './presets';

describe('the drive switch a patch that omits it takes (windsor#309)', () => {
  it('is on for the 808 kick, at gain 1.5', () => {
    const kick = PRESETS['tr808-kick']!;
    expect(kick.drive.gain).toBe(1.5);
    expect(kick.drive.on).toBe(true);
  });

  it('is off for a pad at unity gain with no bias', () => {
    const pad = PRESETS['pad-drift']!;
    expect(pad.drive.gain).toBe(1);
    expect(pad.drive.bias).toBe(0);
    expect(pad.drive.on).toBe(false);
  });

  it('is derived for every library patch, none of which writes it', () => {
    for (const [id, patch] of Object.entries(PRESETS)) {
      expect(patch.drive.on, id).toBe(patch.drive.gain !== 1 || patch.drive.bias !== 0);
    }
  });

  it('is on for a bias alone, and off for a tone or shape alone', () => {
    expect(driveOnByDefault(1, -0.2)).toBe(true);
    expect(makePatch({ drive: { bias: 0.3 } } as PartialPatch).drive.on).toBe(true);
    expect(makePatch({ drive: { tone: 0, shape: 4 } } as PartialPatch).drive.on).toBe(false);
    expect(makePatch().drive.on).toBe(false);
  });

  it('never overrides a switch that is written', () => {
    expect(makePatch({ drive: { on: false, gain: 2 } } as PartialPatch).drive.on).toBe(false);
    expect(makePatch({ drive: { on: true } } as PartialPatch).drive.on).toBe(true);
    const off = mergePatch(PRESETS['tr808-kick']!, { drive: { on: false } } as PartialPatch);
    expect(off.drive).toMatchObject({ on: false, gain: 1.5 });
    // A knob turned while the switch is off leaves it off.
    expect(mergePatch(off, { drive: { gain: 3 } } as PartialPatch).drive.on).toBe(false);
  });
});

describe("a song's drive switch (windsor#309)", () => {
  const PATCHES = {
    kick: { drive: { on: false, gain: 1.5, shape: 3, bias: 0.2, tone: 0.5 } },
    hat: { drive: { on: true, gain: 1, bias: 0 } },
    'saw-arp': { drive: { gain: 1.6 } },
    'drone-sqr': {},
  };

  it('keeps a written switch and derives an omitted one, with no correction', () => {
    const result = makeArrangement(song([KICK], { patches: PATCHES }));
    expect(result.corrections).toEqual([]);
    const patches = result.document.patches!;
    expect(patches['kick']!.drive).toEqual({
      on: false,
      gain: 1.5,
      shape: 3,
      bias: 0.2,
      tone: 0.5,
    });
    expect(patches['hat']!.drive.on).toBe(true);
    expect(patches['saw-arp']!.drive.on).toBe(true);
    expect(patches['drone-sqr']!.drive.on).toBe(false);
  });

  it('survives export and import unchanged', () => {
    const first = makeArrangement(song([KICK], { patches: PATCHES }));
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)) as unknown);
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
    expect(again.document.patches!['kick']!.drive.on).toBe(false);
  });
});
