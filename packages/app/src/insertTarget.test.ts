/**
 * A host's slot child as an insert target (windsor#692): the target names
 * the host by its id and round-trips through one parse, reads the host's
 * `slot`, writes the host's chain with `slot` replaced, and locks a child
 * knob under the host's `slot.<field>` lane. A child kind change drops those
 * lanes in the same edit, so one undo brings the child, its id and its lanes
 * back. Driven over the context with a fake host, as `eqRoundTrip.test.ts`
 * does.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { AutomationLane, InsertSpec } from '@windsor/engine';
import { DEFAULT_CHORUS, DEFAULT_ECHO, partAt } from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { partChange } from './context';
import { DocumentModel } from './documentModel';
import { groupKey } from './groupModel';
import type { EngineHost } from './host';
import { childKindChange } from './insertChildLanes';
import { setChild, setInsertField } from './insertEdits';
import { insertFieldLock } from './insertKnobs';
import type { ChainTarget } from './insertTarget';
import { childAddress, childTarget, insertChange, insertsOf, targetChange } from './insertTarget';
import { insertLaneHolder } from './knobAutomation';
import { library, loadPageLibrary } from './libraryModel';
import { newSong } from './songParts';

beforeAll(() => loadPageLibrary(library));

function openConsole(): AppContext<TabPanel> {
  const host: ContextHost = {
    apply: () => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: () => null,
  };
  const ctx = new AppContext<TabPanel>({
    host: { ...host, transport: { position: () => 0 } } as unknown as EngineHost,
    model: new DocumentModel(newSong()),
    notify: () => {},
  });
  ctx.addTab('mixer', { hidden: false }, () => {});
  return ctx;
}

const CHILD: InsertSpec = { ...DEFAULT_CHORUS, id: 'c' };
const ECHO: InsertSpec = { ...DEFAULT_ECHO, id: 'h', slot: CHILD };
const lane = (field: string, value: number): AutomationLane =>
  ({
    target: `insert.h.${field}`,
    on: true,
    points: [{ tick: 0, value, bend: 0 }],
  }) as AutomationLane;
const SLOT_RATE = lane('slot.rate', 1.5);
const ECHO_MIX = lane('mix', 0.5);

/** A console whose part at slot 0 holds the Echo with its Chorus child, and two lanes. */
function withEcho(): AppContext<TabPanel> {
  const ctx = openConsole();
  expect(ctx.change(insertChange(0, [ECHO])).ok).toBe(true);
  expect(ctx.change(partChange(0, { automation: [SLOT_RATE, ECHO_MIX] })).ok).toBe(true);
  return ctx;
}

describe('the child target', () => {
  it('round-trips the chain and the host id through one parse, and names no other target', () => {
    const chains: ChainTarget[] = [3, 'master', 'a', 'b', groupKey(2)];
    for (const chain of chains) {
      for (const hostId of ['h', 'x/y']) {
        expect(childAddress(childTarget(chain, hostId))).toEqual({ chain, hostId });
      }
    }
    for (const other of [0, 'master', 'a', groupKey(1), 'child:', 'child:nope/h', 'child:2/'])
      expect(childAddress(other as ChainTarget)).toBeNull();
  });

  it('reads the host’s slot and writes the host’s chain with the slot replaced', () => {
    const ctx = withEcho();
    const child = childTarget(0, 'h');
    expect(insertsOf(ctx, child)).toEqual([CHILD]);
    expect(ctx.change(targetChange(ctx, child, setInsertField([CHILD], 0, 'rate', 2))).ok).toBe(
      true,
    );
    const [host] = insertsOf(ctx, 0);
    expect(host).toMatchObject({
      kind: 'echo',
      id: 'h',
      slot: { kind: 'chorus', id: 'c', rate: 2 },
    });
    expect(insertsOf(ctx, childTarget(0, 'gone'))).toEqual([]);
  });

  it('locks a child knob under the host’s lane on slot.<field>', () => {
    const ctx = withEcho();
    const child = childTarget(0, 'h');
    expect(insertFieldLock(ctx, child, 0, 'rate').automation?.()?.value).toBe(1.5);
    expect(insertFieldLock(ctx, child, 0, 'depth').automation?.()).toBeNull();
    expect(insertFieldLock(ctx, childTarget('master', 'h'), 0, 'rate').automation).toBeUndefined();
  });
});

describe('a child kind change', () => {
  it('drops the slot’s lanes in the same edit; undo brings child, id and lanes back, redo drops them', () => {
    const ctx = withEcho();
    const before = partAt(ctx.model.doc, 0)!;
    const inserts = setChild(insertsOf(ctx, 0), 'h', 'phaser');
    const holder = insertLaneHolder(ctx.model.doc, 0);
    expect(ctx.change(childKindChange({ chain: 0, inserts, hostId: 'h', holder })).ok).toBe(true);
    const after = partAt(ctx.model.doc, 0)!;
    expect(after.automation?.map((l) => l.target)).toEqual(['insert.h.mix']);
    expect(insertsOf(ctx, childTarget(0, 'h'))[0]?.kind).toBe('phaser');

    expect(ctx.undo()).toBe(true);
    expect(partAt(ctx.model.doc, 0)!.strip.inserts).toEqual(before.strip.inserts);
    expect(partAt(ctx.model.doc, 0)!.automation).toEqual(before.automation);
    expect(ctx.redo()).toBe(true);
    expect(partAt(ctx.model.doc, 0)!.automation).toEqual(after.automation);
  });

  it('writes the chain alone where no lane holds the slot', () => {
    const inserts = [ECHO];
    for (const chain of ['master', 'a'] as const) {
      expect(childKindChange({ chain, inserts, hostId: 'h', holder: undefined })).toEqual(
        insertChange(chain, inserts),
      );
    }
    const unheld = { automation: [ECHO_MIX] };
    expect(childKindChange({ chain: 0, inserts, hostId: 'h', holder: unheld })).toEqual(
      insertChange(0, inserts),
    );
  });
});
