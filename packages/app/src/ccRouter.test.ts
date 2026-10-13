import {
  type CcMapping,
  type CcTargetId,
  type Patch,
  ccValue,
  makeMacro,
  makePatch,
  requireCatalogRow,
} from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import type { CcEngine, CcMessage } from './ccEngine';
import { CcRouter } from './ccRouter';
import type { CcTakeover } from './ccTakeover';

const LEVEL: CcTargetId = 'voice.ops.0.level';
const CUTOFF: CcTargetId = 'voice.filter.cutoff';
const LEVEL_ROW = requireCatalogRow(LEVEL);
const at = (part: number, target: CcTargetId): string => `${part}|${target}`;

/** A fake engine: each target's own value, lanes on, patches, and a log of applies and clears. */
function rig(takeover: CcTakeover = 'pickup') {
  const own = new Map<string, number>([[at(0, LEVEL), 40 / 127]]);
  const lanes = new Set<string>();
  const patches = new Map<number, Patch>();
  const log: string[] = [];
  const state = { slots: true };
  const engine: CcEngine = {
    target: (part, target) => {
      const value = own.get(at(part, target));
      return value === undefined ? undefined : { row: requireCatalogRow(target), own: value };
    },
    patch: (part) => patches.get(part),
    automated: (part, target) => lanes.has(at(part, target)),
    apply: (part, target, value) => {
      if (!state.slots) return 'noSlot';
      log.push(`apply ${part} ${target} ${value}`);
      return 'applied';
    },
    clear: (part, target) => void log.push(`clear ${part} ${target}`),
  };
  return { router: new CcRouter(engine, takeover), own, lanes, patches, log, state };
}

/** The level mapping as learn records it: Keys, channel 1, CC 74, the full range. */
const learned = (o: Partial<CcMapping> = {}): CcMapping => ({
  source: { device: 'Keys', channel: 1, cc: 74 },
  target: LEVEL,
  min: 0,
  max: 1,
  inverted: false,
  ...o,
});

const cc = (value: number, o: Partial<CcMessage> = {}): CcMessage => ({
  device: 'Keys',
  channel: 1,
  cc: 74,
  value,
  ...o,
});

const applied = (log: readonly string[]): string[] => log.filter((l) => l.startsWith('apply'));
const level = (value: number): string => `apply 0 ${LEVEL} ${value}`;

type Rig = ReturnType<typeof rig>;
interface Rearm {
  /** The event, after the knob has picked up at 40 and moved to 41. */
  readonly act: (r: Rig) => void;
  /** The mapping in force after the event, when the event edits it. */
  readonly after?: CcMapping;
  /** The next message's source, when the event moves it. */
  readonly from?: Partial<CcMessage> | undefined;
}

const edit = (after: CcMapping, from?: Partial<CcMessage>): Rearm => ({
  act: (r) => r.router.mappingsChanged([{ part: 0, mapping: after }]),
  after,
  from,
});

/** Decision 4's re-arm events, each on the router. */
const REARMS: Readonly<Record<string, Rearm>> = {
  'a song opening': { act: (r) => r.router.songOpened([{ part: 0, mapping: learned() }]) },
  'a preset change': { act: (r) => r.router.presetChanged(0) },
  'a range edit': edit(learned({ max: 0.5 })),
  'Inv toggled': edit(learned({ inverted: true })),
  'Learn onto another CC': edit(learned({ source: { device: 'Keys', channel: 1, cc: 75 } }), {
    cc: 75,
  }),
  'the device widened to Any': edit(learned({ source: { device: null, channel: 1, cc: 74 } })),
  'the channel widened to Any': edit(
    learned({ source: { device: 'Keys', channel: null, cc: 74 } }),
  ),
  'an on-screen edit of the target': {
    act: (r) => {
      r.own.set(at(0, LEVEL), 60 / 127);
      r.router.targetEdited(0, LEVEL);
    },
  },
  'Reset performance': { act: (r) => r.router.resetPerformance() },
  'the input unplugged and plugged back in': { act: (r) => r.router.inputListened('Keys') },
  'the input deselected and selected again': { act: (r) => r.router.inputListened('Keys') },
  'a lane on the target switched off': { act: (r) => r.router.laneReleased(0, LEVEL) },
};

describe('re-arming pickup (decision 4)', () => {
  /** Pick up at 40, move to 41, run the event, then send 100: past the old position. */
  function playThrough(takeover: CcTakeover, rearm: Rearm): Rig {
    const r = rig(takeover);
    r.router.songOpened([{ part: 0, mapping: learned() }]);
    r.router.handle(cc(40));
    r.router.handle(cc(41));
    expect(applied(r.log)).toEqual([level(40 / 127), level(41 / 127)]);
    rearm.act(r);
    r.router.handle(cc(100, rearm.from));
    return r;
  }

  it.each(Object.entries(REARMS))('%s: no jump under Pickup', (_, rearm) => {
    const r = playThrough('pickup', rearm);
    expect(applied(r.log)).toHaveLength(2);
    expect(r.router.status(0, LEVEL)?.kind).toBe('waiting');
  });

  it.each(Object.entries(REARMS))('%s: the next value applies under Jump', (_, rearm) => {
    const r = playThrough('jump', rearm);
    expect(applied(r.log).at(-1)).toBe(level(ccValue(LEVEL_ROW, rearm.after ?? learned(), 100)));
  });

  it('keeps the hardware position for the marker after a range edit, not after an unplug', () => {
    const r = rig();
    r.router.songOpened([{ part: 0, mapping: learned() }]);
    r.router.handle(cc(40));
    r.router.mappingsChanged([{ part: 0, mapping: learned({ max: 0.5 }) }]);
    expect(r.router.status(0, LEVEL)).toEqual({
      kind: 'waiting',
      marker: { cc: 40, value: (40 / 127) * 0.5 },
    });
    r.router.inputListened('Keys');
    expect(r.router.status(0, LEVEL)).toEqual({ kind: 'waiting', marker: null });
  });
});

describe('last in wins (decision 2)', () => {
  it('clears the held CC value on an on-screen edit, a preset change and Reset', () => {
    const r = rig();
    r.router.songOpened([{ part: 0, mapping: learned() }]);
    r.router.targetEdited(0, LEVEL);
    expect(r.log).toEqual([]);
    for (const event of [
      () => r.router.targetEdited(0, LEVEL),
      () => r.router.presetChanged(0),
      () => r.router.resetPerformance(),
    ]) {
      r.log.length = 0;
      r.router.handle(cc(40));
      event();
      expect(r.log).toEqual([level(40 / 127), `clear 0 ${LEVEL}`]);
    }
  });

  it('clears a removed mapping’s value', () => {
    const r = rig('jump');
    r.router.songOpened([{ part: 0, mapping: learned() }]);
    r.router.handle(cc(90));
    r.router.mappingsChanged([]);
    expect(r.log.at(-1)).toBe(`clear 0 ${LEVEL}`);
    expect(r.router.status(0, LEVEL)).toBeUndefined();
  });
});

describe('routing (decision 1)', () => {
  it('keeps driving part A’s mapping whichever part is selected, and never reaches B', () => {
    const r = rig('jump');
    r.own.set(at(1, LEVEL), 0.5);
    const onB = learned({ source: { device: 'Keys', channel: 1, cc: 71 } });
    r.router.songOpened([
      { part: 0, mapping: learned() },
      { part: 1, mapping: onB },
    ]);
    // Selecting part B moves the keys, not the router: nothing here knows the selection.
    for (const v of [10, 20, 30]) r.router.handle(cc(v));
    expect(applied(r.log)).toEqual([10, 20, 30].map((v) => level(v / 127)));
  });

  it('drives every mapping the CC matches, across parts', () => {
    const r = rig('jump');
    r.own.set(at(1, LEVEL), 0.5);
    r.router.songOpened([0, 1].map((part) => ({ part, mapping: learned() })));
    r.router.handle(cc(127));
    expect(applied(r.log)).toEqual([level(1), `apply 1 ${LEVEL} 1`]);
  });

  it('matches the device and the channel unless they are Any', () => {
    const r = rig('jump');
    r.router.songOpened([{ part: 0, mapping: learned() }]);
    r.router.handle(cc(10, { device: 'Pads' }));
    r.router.handle(cc(10, { channel: 2 }));
    r.router.handle(cc(10, { cc: 75 }));
    r.router.handle(cc(10, { device: null }));
    expect(r.log).toEqual([]);
    r.router.mappingsChanged([
      { part: 0, mapping: learned({ source: { device: null, channel: null, cc: 74 } }) },
    ]);
    r.router.handle(cc(10, { device: 'Pads', channel: 2 }));
    r.router.handle(cc(11, { device: null, channel: 16 }));
    expect(applied(r.log)).toEqual([level(10 / 127), level(11 / 127)]);
  });
});

describe('pickup (decision 7)', () => {
  const any = learned({ source: { device: null, channel: null, cc: 74 } });

  it('picks up two devices on one CC apart, on a mapping on Any device', () => {
    const r = rig();
    r.router.songOpened([{ part: 0, mapping: any }]);
    r.router.handle(cc(40, { device: 'Keys' }));
    r.router.handle(cc(50, { device: 'Keys' }));
    r.router.handle(cc(90, { device: 'Pads' }));
    r.router.handle(cc(60, { device: 'Pads' }));
    expect(applied(r.log)).toEqual([level(40 / 127), level(50 / 127)]);
    r.router.handle(cc(45, { device: 'Pads' }));
    expect(applied(r.log).at(-1)).toBe(level(45 / 127));
    // Pads moved the target away from Keys, so Keys picks up again.
    r.router.handle(cc(52, { device: 'Keys' }));
    expect(applied(r.log)).toHaveLength(3);
  });

  it('picks up one device on two channels apart, on a mapping on Any channel', () => {
    const r = rig();
    r.router.songOpened([{ part: 0, mapping: any }]);
    r.router.handle(cc(40, { channel: 1 }));
    r.router.handle(cc(90, { channel: 2 }));
    expect(applied(r.log)).toEqual([level(40 / 127)]);
    r.router.handle(cc(30, { channel: 2 }));
    expect(applied(r.log).at(-1)).toBe(level(30 / 127));
  });

  it('picks up 1 kHz under a 2–6 kHz cutoff mapping at CC 0, and at CC 127 inverted', () => {
    for (const [inverted, edge] of [
      [false, 0],
      [true, 127],
    ] as const) {
      const r = rig();
      r.own.set(at(0, CUTOFF), 1000);
      const mapping = learned({ target: CUTOFF, min: 2000, max: 6000, inverted });
      r.router.songOpened([{ part: 0, mapping }]);
      r.router.handle(cc(64));
      r.router.handle(cc(inverted ? 122 : 5));
      expect(r.log).toEqual([]);
      r.router.handle(cc(edge));
      expect(r.log).toEqual([`apply 0 ${CUTOFF} 2000`]);
    }
  });

  it('applies at once when min equals max: there is nothing to pick up', () => {
    const r = rig();
    r.router.songOpened([{ part: 0, mapping: learned({ min: 0.7, max: 0.7 }) }]);
    expect(r.router.status(0, LEVEL)).toEqual({ kind: 'live', value: 40 / 127, held: false });
    r.router.handle(cc(3));
    expect(r.log).toEqual([level(0.7)]);
  });
});

describe('status (decision 12)', () => {
  it('waits with no marker until a value is heard, then shows it, then goes live', () => {
    const r = rig();
    r.router.songOpened([{ part: 0, mapping: learned() }]);
    expect(r.router.status(0, LEVEL)).toEqual({ kind: 'waiting', marker: null });
    r.router.handle(cc(10));
    expect(r.router.status(0, LEVEL)).toEqual({
      kind: 'waiting',
      marker: { cc: 10, value: 10 / 127 },
    });
    r.router.handle(cc(45));
    expect(r.router.status(0, LEVEL)).toEqual({ kind: 'live', value: 45 / 127, held: true });
  });

  it('shows the target’s own value under Jump before any move', () => {
    const r = rig('jump');
    r.router.songOpened([{ part: 0, mapping: learned() }]);
    expect(r.router.status(0, LEVEL)).toEqual({ kind: 'live', value: 40 / 127, held: false });
  });

  it('reads Automated while a lane is on, and ignores the CC', () => {
    const r = rig('jump');
    r.lanes.add(at(0, LEVEL));
    r.router.songOpened([{ part: 0, mapping: learned() }]);
    r.router.handle(cc(90));
    expect(r.log).toEqual([]);
    expect(r.router.status(0, LEVEL)).toEqual({ kind: 'automated' });
  });

  it('reads Inert on a target the patch’s macro maps, or a macro it lacks, and ignores the CC', () => {
    const r = rig('jump');
    r.own.set(at(0, 'voice.macros.1.value'), 0);
    r.patches.set(
      0,
      makePatch({ macros: [makeMacro({ name: 'Accent', mappings: [{ target: 'ops.0.level' }] })] }),
    );
    r.router.songOpened([
      { part: 0, mapping: learned() },
      { part: 0, mapping: learned({ target: 'voice.macros.1.value' }) },
    ]);
    r.router.handle(cc(90));
    expect(r.log).toEqual([]);
    expect(r.router.status(0, LEVEL)).toEqual({ kind: 'inert', reason: 'mapped by Accent' });
    expect(r.router.status(0, 'voice.macros.1.value')).toEqual({
      kind: 'inert',
      reason: 'no Macro 2 in this patch',
    });
  });

  it('reads No voice slot until a slot frees', () => {
    const r = rig('jump');
    r.state.slots = false;
    r.router.songOpened([{ part: 0, mapping: learned() }]);
    r.router.handle(cc(90));
    expect(r.router.status(0, LEVEL)).toEqual({ kind: 'noSlot' });
    r.state.slots = true;
    r.router.handle(cc(91));
    expect(r.router.status(0, LEVEL)).toEqual({ kind: 'live', value: 91 / 127, held: true });
  });
});
