/**
 * The three sections that make a document the whole piece of music (#435):
 * `patches` (named FM patches, document-first resolution), `returns`
 * (overlays over the code's `RETURNS`) and their normalisation — never
 * throws, every junk value corrected by path, a return name the code does
 * not define dangling.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from './__fixtures__/fullArrangement';
import { isShippable, makeArrangement } from './arrangementDocument';
import { DELAY_FEEDBACK_MAX, REVERB_SPACE_RANGES } from './audioConstants';
import { RETURNS } from './mix';
import { makePatch } from './patch';
import { PRESETS } from './presets';

describe('the patches section', () => {
  it('completes a partial patch against makePatch() and names it after its key', () => {
    const r = makeArrangement({ ...FULL_ARRANGEMENT, patches: { lead: { volume: 0.3 } } });
    expect(r.corrections).toEqual([]);
    expect(r.document.patches?.lead).toEqual(makePatch({ name: 'lead', volume: 0.3 }));
  });

  it('keeps a name the patch carries', () => {
    const r = makeArrangement({ ...FULL_ARRANGEMENT, patches: { lead: { name: 'Lead Bell' } } });
    expect(r.document.patches?.lead?.name).toBe('Lead Bell');
  });

  it('resolves a part preset against the document first, then the built-ins', () => {
    const r = makeArrangement({
      ...FULL_ARRANGEMENT,
      arp: { ...FULL_ARRANGEMENT.arp, preset: 'lead' },
      patches: { lead: { volume: 0.3 } },
    });
    expect(r.dangling).toEqual([]);
    expect(r.document.arp?.preset).toBe('lead');
    expect(isShippable(r)).toBe(true);
    // A document patch named like a built-in shadows it — no dangling report either way.
    const shadow = makeArrangement({ ...FULL_ARRANGEMENT, patches: { kick: { volume: 0.1 } } });
    expect(shadow.dangling).toEqual([]);
    expect(PRESETS.kick).toBeDefined();
  });

  it('drops a part whose preset is in neither, reported as dangling', () => {
    const r = makeArrangement({
      ...FULL_ARRANGEMENT,
      arp: { ...FULL_ARRANGEMENT.arp, preset: 'nope' },
      patches: { lead: {} },
    });
    expect(r.document.arp).toBeUndefined();
    expect(r.dangling).toEqual(['arp.preset: no preset "nope" is defined']);
  });

  it('corrects junk fields by path, drops unknown keys, and keeps the array shapes', () => {
    const r = makeArrangement({
      ...FULL_ARRANGEMENT,
      patches: {
        lead: {
          volume: 'loud',
          wat: 1,
          ops: [{ wave: 1, env: { attackTime: null } }, 'junk'],
          lfo: { toOp: [1, 2] },
          filter: { slope24: 'yes' },
        },
      },
    });
    expect(r.corrections).toEqual([
      'patches.lead.wat: unknown key dropped',
      'patches.lead.volume: "loud" is not a number — using 0.8',
      'patches.lead.ops: 2 entries for 4 — resized',
      'patches.lead.ops[0].env.attackTime: null is not a number — using 0.002',
      'patches.lead.ops[1]: "junk" is not an object — using defaults',
      'patches.lead.lfo.toOp: 2 entries for 4 — resized',
      'patches.lead.filter.slope24: "yes" is not a boolean — using false',
    ]);
    const lead = r.document.patches?.lead;
    expect(lead?.ops).toHaveLength(4);
    expect(lead?.ops[0]?.wave).toBe(1);
    expect(lead?.lfo.toOp).toEqual([1, 2, 0, 0]);
    expect(lead?.filter.slope24).toBe(false);
  });

  it('accepts user partials as a list of numbers and nothing else', () => {
    const r = makeArrangement({
      ...FULL_ARRANGEMENT,
      patches: { a: { ops: [{ userPartials: [1, 0.5] }] }, b: { ops: [{ userPartials: 'x' }] } },
    });
    expect(r.document.patches?.a?.ops[0]?.userPartials).toEqual([1, 0.5]);
    expect(r.document.patches?.b?.ops[0]?.userPartials).toBeNull();
    expect(r.corrections).toContain(
      'patches.b.ops[0].userPartials: "x" is not a list of partials — using none',
    );
  });

  it('drops a patch that is not an object, and a section that is not one', () => {
    const r = makeArrangement({ ...FULL_ARRANGEMENT, patches: { lead: 3 } });
    expect(r.document.patches).toBeUndefined();
    expect(r.corrections).toEqual(['patches.lead: 3 is not a patch — dropped']);
    const junk = makeArrangement({ ...FULL_ARRANGEMENT, patches: [] });
    expect(junk.document.patches).toBeUndefined();
    expect(junk.corrections).toEqual(['patches: [] is not an object — using defaults']);
  });
});

describe('the returns section', () => {
  it('overlays the code return: named fields change, the rest is the base', () => {
    const r = makeArrangement({
      ...FULL_ARRANGEMENT,
      returns: { room: { level: 0.5, space: { size: 2 } }, echo: { delayTime: 0.5 } },
    });
    expect(r.corrections).toEqual([]);
    expect(r.document.returns?.room).toEqual({
      kind: 'reverb',
      level: 0.5,
      space: { ...RETURNS.room.space, size: 2 },
    });
    expect(r.document.returns?.echo).toEqual({ ...RETURNS.echo, delayTime: 0.5 });
  });

  it('clamps into the worklet ranges and the delay bounds, by path', () => {
    const r = makeArrangement({
      ...FULL_ARRANGEMENT,
      returns: { room: { level: 3, space: { size: 99 } }, echo: { feedback: 1.5, damp: 1 } },
    });
    const room = r.document.returns?.room;
    const echo = r.document.returns?.echo;
    expect(room?.level).toBe(1);
    expect(room?.kind === 'reverb' && room.space.size).toBe(REVERB_SPACE_RANGES.size[1]);
    expect(echo?.kind === 'delay' && echo.feedback).toBe(DELAY_FEEDBACK_MAX);
    expect(r.corrections).toEqual([
      'returns.room.level: clamped 3 to 1',
      'returns.room.space.size: clamped 99 to 4',
      'returns.echo.feedback: clamped 1.5 to 0.95',
      'returns.echo.damp: clamped 1 to 10',
    ]);
  });

  it('keeps the code kind, and drops fields of the other kind as unknown', () => {
    const r = makeArrangement({
      ...FULL_ARRANGEMENT,
      returns: { room: { kind: 'delay', delayTime: 1 } },
    });
    expect(r.document.returns?.room?.kind).toBe('reverb');
    expect(r.corrections).toEqual([
      "returns.room.kind: delay is not the code's reverb — kept",
      'returns.room.delayTime: unknown key dropped',
    ]);
  });

  it('reports a return the code does not define as dangling, which fails the gate', () => {
    const r = makeArrangement({ ...FULL_ARRANGEMENT, returns: { cave: { level: 1 } } });
    expect(r.document.returns).toBeUndefined();
    expect(r.dangling).toEqual(['returns.cave: no return "cave" is defined']);
    expect(isShippable(r)).toBe(false);
  });

  it('treats an inherited object name as no return at all (review finding 2)', () => {
    const r = makeArrangement({ ...FULL_ARRANGEMENT, returns: { constructor: { level: 0.5 } } });
    expect(r.document.returns).toBeUndefined();
    expect(r.dangling).toEqual(['returns.constructor: no return "constructor" is defined']);
  });

  it('round-trips: the normalised document normalises to itself with no corrections', () => {
    const first = makeArrangement({
      ...FULL_ARRANGEMENT,
      patches: { lead: { volume: 0.3 } },
      returns: { room: { space: { decay: 0.5 } } },
    });
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});
