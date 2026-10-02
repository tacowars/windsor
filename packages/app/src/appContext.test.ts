/**
 * The application context over fakes (#620 decisions 1–3): a host that
 * accepts every change and builds instantly, panels that are nothing but a
 * `hidden` flag, and renderers that count. What the tests pin is the render
 * discipline — only the active tab renders on a change, a hidden tab renders
 * once when shown, a structural change or an import invalidates every tab —
 * and the session's commit landing in the document under the selected
 * part's preset.
 */
/* eslint-disable max-lines -- one fixture (the fake console) over every context rule; #709 added the Song view's three cases and windsor#193 the tab-shown hook's, which keep it just over */
import { beforeAll, describe, expect, it } from 'vitest';

import type { ApplyResult, AudioPart, DocumentPartial } from '@windsor/engine';
import {
  TICKS_PER_BAR,
  clonePatch,
  makePatch,
  partAt,
  songTicksOf,
  ticksPerBar,
} from '@windsor/engine';
import { PRESETS } from '@windsor/engine/patch/presets';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { partChange } from './context';
import { DocumentModel } from './documentModel';
import { appendEvent } from './harmonyLaneModel';
import type { BuildOptions, EngineHost } from './host';
import { initPresetId } from './libraryConstants';
import { dropInit } from './patchActions';
import { addPartLive, removePartLive, setSequencerKindLive } from './partEdits';
import { renamePatch, revertPatch } from './patchLibrary';
import { newSong } from './songParts';
import { barsChange, bpmChange, keyChange, meterChange, scaleChange } from './transportModel';
import { library, loadPageLibrary } from './libraryModel';

// The built-in library loads on demand in the page; these tests read it
// through the console's shared model, as the page does after boot.
beforeAll(() => loadPageLibrary(library));

const TAB_IDS = ['parts', 'mixer', 'song', 'arrangement'] as const;

interface Console {
  ctx: AppContext<TabPanel>;
  model: DocumentModel;
  renders: Record<string, number>;
  panels: Record<string, TabPanel>;
  status: string[];
  applied: DocumentPartial[];
  builds: number;
  /** The options each build was handed, in order. */
  buildOptions: BuildOptions[];
  /** The live parts the fake host hands out by slot, once "enabled". */
  liveParts: Map<number, AudioPart>;
  /** The fake host's state: `null` from `apply` while unenabled or building; `building` says which. */
  host: { enabled: boolean; building: boolean };
}

/** A console whose host accepts everything; `refuse` makes it reject every change instead. */
function openConsole(refuse = false): Console {
  const applied: DocumentPartial[] = [];
  const status: string[] = [];
  const console: Console = {
    ctx: null as unknown as AppContext<TabPanel>,
    model: new DocumentModel(newSong()),
    renders: {},
    panels: {},
    status,
    applied,
    builds: 0,
    buildOptions: [],
    liveParts: new Map(),
    host: { enabled: true, building: false },
  };
  const host: ContextHost = {
    apply: (partial): ApplyResult | null => {
      if (!console.host.enabled) return null;
      applied.push(partial);
      return refuse ? { ok: false, ignored: [], error: 'nope' } : { ok: true, ignored: [] };
    },
    build: (_document, options = {}) => {
      console.builds++;
      console.buildOptions.push(options);
      return Promise.resolve();
    },
    get isBuilding(): boolean {
      return console.host.building;
    },
    capturePattern: () => null,
    part: (slot) => console.liveParts.get(slot) ?? null,
  };
  console.ctx = new AppContext<TabPanel>({
    host: host as EngineHost,
    model: console.model,
    notify: (message) => status.push(message),
  });
  for (const id of TAB_IDS) {
    console.renders[id] = 0;
    console.panels[id] = { hidden: false };
    console.ctx.addTab(id, console.panels[id], () => {
      console.renders[id] = (console.renders[id] ?? 0) + 1;
    });
  }
  return console;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('AppContext rendering', () => {
  it('shows the first tab, renders only it, and keeps the rest for their activation', () => {
    const c = openConsole();
    expect(c.ctx.activeTab).toBe('parts');
    expect(Object.values(c.renders).every((n) => n === 0)).toBe(true);
    c.ctx.render();
    expect(c.renders).toEqual({ parts: 1, mixer: 0, song: 0, arrangement: 0 });
    expect(c.panels['parts']?.hidden).toBe(false);
    expect(TAB_IDS.filter((id) => id !== 'parts').every((id) => c.panels[id]?.hidden)).toBe(true);
  });

  it('renders only the active tab on a change after an import', async () => {
    const c = openConsole();
    c.ctx.render();
    c.ctx.importDoc(newSong());
    await flush();
    // Once for the adopted document, once when the live rebuild landed — the active tab only.
    expect(c.builds).toBe(1);
    expect(c.renders).toEqual({ parts: 3, mixer: 0, song: 0, arrangement: 0 });
    const result = c.ctx.change({ transport: { bpm: 120 } } as DocumentPartial);
    c.ctx.render();
    expect(result.ok).toBe(true);
    expect(c.applied).toHaveLength(1);
    expect(c.renders).toEqual({ parts: 4, mixer: 0, song: 0, arrangement: 0 });
  });

  it('renders a dirty tab once when switched to, and a clean one not at all', () => {
    const c = openConsole();
    c.ctx.render();
    c.ctx.activate('mixer');
    expect(c.ctx.activeTab).toBe('mixer');
    expect(c.panels['mixer']?.hidden).toBe(false);
    expect(c.panels['parts']?.hidden).toBe(true);
    expect(c.renders['mixer']).toBe(1);
    c.ctx.activate('mixer');
    expect(c.renders['mixer']).toBe(1);
    // Parts rendered while it was active and nothing changed since: no work.
    c.ctx.activate('parts');
    expect(c.renders['parts']).toBe(1);
    // An unknown tab changes nothing.
    c.ctx.activate('nowhere');
    expect(c.ctx.activeTab).toBe('parts');
  });

  it('tells a tab-shown listener the state now and on each change, until stopped (windsor#193)', () => {
    const c = openConsole();
    const heard: boolean[] = [];
    const stop = c.ctx.onTabShown('mixer', (shown) => heard.push(shown));
    c.ctx.activate('mixer');
    c.ctx.activate('mixer');
    c.ctx.activate('song');
    c.ctx.activate('parts');
    expect(heard).toEqual([false, true, false]);
    stop();
    c.ctx.activate('mixer');
    expect(heard).toEqual([false, true, false]);
    const early: boolean[] = [];
    const fresh = new AppContext<TabPanel>({
      host: {} as EngineHost,
      model: c.model,
      notify: () => undefined,
    });
    fresh.onTabShown('parts', (shown) => early.push(shown));
    fresh.addTab('parts', { hidden: true }, () => undefined);
    fresh.addTab('mixer', { hidden: true }, () => undefined);
    expect(early).toEqual([false, true]);
  });

  it('invalidates every tab on an import', async () => {
    const c = openConsole();
    for (const id of TAB_IDS) c.ctx.activate(id);
    c.ctx.activate('song');
    const before = { ...c.renders };
    c.ctx.importDoc(newSong());
    await flush();
    expect(c.renders['song']).toBe((before['song'] ?? 0) + 2);
    for (const id of TAB_IDS) {
      if (id !== 'song') expect(c.renders[id], id).toBe(before[id]);
    }
    for (const id of TAB_IDS) c.ctx.activate(id);
    for (const id of TAB_IDS) {
      if (id !== 'song') expect(c.renders[id], id).toBe((before[id] ?? 0) + 1);
    }
  });
});

describe('AppContext changes and the parts session', () => {
  it('merges an accepted change and reports a refused one without merging', () => {
    const accepted = openConsole();
    expect(accepted.ctx.change({ transport: { bpm: 133 } } as DocumentPartial).ok).toBe(true);
    expect(accepted.model.doc.transport.bpm).toBe(133);

    const refused = openConsole(true);
    const bpm = refused.model.doc.transport.bpm;
    expect(refused.ctx.change({ transport: { bpm: 133 } } as DocumentPartial).ok).toBe(false);
    expect(refused.model.doc.transport.bpm).toBe(bpm);
    expect(refused.status.at(-1)).toBe('refused: nope');
  });

  it('resolves the live part at the call, so a hidden Parts tab never leaves the keyboard stale', () => {
    const c = openConsole();
    c.ctx.activate('mixer');
    expect(c.ctx.livePart()).toBeNull();
    // Audio enabled, or the system rebuilt, while Mixer is showing: the next
    // key press reaches the part the host holds now, not the one a Parts
    // render once captured.
    const live = { slot: 0 } as unknown as AudioPart;
    c.liveParts.set(0, live);
    expect(c.ctx.livePart()).toBe(live);
    const rebuilt = { slot: 0 } as unknown as AudioPart;
    c.liveParts.set(0, rebuilt);
    expect(c.ctx.livePart()).toBe(rebuilt);
    c.ctx.parts.selected = 99;
    expect(c.ctx.livePart()).toBeNull();
  });

  it("commits the working patch under the selected part's preset, and nowhere without a part", () => {
    const c = openConsole();
    const part = partAt(c.model.doc, c.ctx.parts.selected);
    if (!part) throw new Error('a new song has a part on slot 0');
    c.ctx.parts.patch = makePatch({ name: 'Edited' });
    expect(c.ctx.parts.push()).toBe(true);
    expect(c.model.doc.patches?.[part.preset]?.name).toBe('Edited');
    expect(c.applied.at(-1)).toEqual({ patches: { [part.preset]: c.ctx.parts.patch } });

    c.ctx.parts.selected = 99;
    const applied = c.applied.length;
    expect(c.ctx.parts.push()).toBe(false);
    expect(c.applied).toHaveLength(applied);
  });
});

describe('structural edits stay live (#629)', () => {
  it('adds a part, sets its kind and removes it through host.apply, never host.build', () => {
    const c = openConsole();
    c.ctx.render();
    expect(addPartLive(c.ctx)).toBe(1);
    const added = c.applied.at(-1);
    const part = partAt(c.model.doc, 1);
    if (!part) throw new Error('the part landed in the document');
    // The whole part, as the normaliser fills it — strip included — and its Init patch.
    expect(added?.parts?.[1]).toEqual(part);
    expect(Object.keys(added?.patches ?? {})).toEqual([part.preset]);
    expect(c.model.doc.parts.map((p) => p.slot)).toEqual([0, 1]);
    expect(c.ctx.parts.selected).toBe(1);

    expect(setSequencerKindLive(c.ctx, 1, 'euclidean')).toBe(true);
    // The kind's whole default spec, not a bare kind the engine would refuse.
    expect(c.applied.at(-1)).toEqual({
      parts: { 1: { sequencer: partAt(c.model.doc, 1)?.sequencer } },
    });
    expect(partAt(c.model.doc, 1)?.sequencer.kind).toBe('euclidean');
    const applied = c.applied.length;
    expect(setSequencerKindLive(c.ctx, 1, 'euclidean')).toBe(false);
    expect(c.applied).toHaveLength(applied);

    expect(removePartLive(c.ctx, 1)).toBe(true);
    expect(c.applied.at(-1)).toEqual({ parts: { 1: null }, patches: { [part.preset]: null } });
    expect(c.model.doc.parts.map((p) => p.slot)).toEqual([0]);
    expect(c.model.doc.patches?.[part.preset]).toBeUndefined();
    expect(c.ctx.parts.selected).toBe(0);

    expect(c.builds).toBe(0);
    expect(c.renders['parts']).toBe(4);
  });

  it('a refused live edit changes nothing and never falls back to a rebuild', () => {
    const c = openConsole(true);
    expect(addPartLive(c.ctx)).toBeNull();
    expect(c.model.doc.parts).toHaveLength(1);
    expect(setSequencerKindLive(c.ctx, 0, 'grid')).toBe(false);
    expect(partAt(c.model.doc, 0)?.sequencer.kind).toBe('none');
    expect(c.builds).toBe(0);
    expect(c.status.at(-1)).toBe('refused: nope');
  });

  it('drops a stale Init live after the first patch pick — the restart tacowars heard', () => {
    const c = openConsole();
    addPartLive(c.ctx);
    const init = initPresetId('1');
    expect(c.model.doc.patches?.[init]).toBeDefined();
    c.ctx.change({
      parts: { 1: { preset: 'kick' } },
      patches: { kick: clonePatch(PRESETS['kick']!) },
    });
    dropInit(c.ctx);
    expect(c.applied.at(-1)).toEqual({ patches: { [init]: null } });
    expect(c.model.doc.patches?.[init]).toBeUndefined();
    expect(partAt(c.model.doc, 1)?.preset).toBe('kick');
    expect(c.builds).toBe(0);
  });

  it('renames and reverts a document patch live', () => {
    const c = openConsole();
    const from = initPresetId('0');
    renamePatch(c.ctx, from, 'lead');
    expect(c.applied.at(-1)).toMatchObject({
      patches: { [from]: null },
      parts: { 0: { preset: 'lead' } },
    });
    expect(partAt(c.model.doc, 0)?.preset).toBe('lead');
    // The display name follows only when it was the old id; Init's stays "Init".
    expect(c.model.doc.patches?.['lead']?.name).toBe('Init');
    expect(c.model.doc.patches?.[from]).toBeUndefined();
    c.ctx.change({
      parts: { 0: { preset: 'kick' } },
      patches: { kick: makePatch({ name: 'edited' }) },
    });
    revertPatch(c.ctx, 'kick');
    expect(c.applied.at(-1)).toEqual({ patches: { kick: PRESETS['kick'] } });
    expect(c.model.doc.patches?.['kick']?.name).toBe(PRESETS['kick']?.name);
    expect(c.builds).toBe(0);
  });

  it('Import still rebuilds from the document — the one rebuild left since #709', async () => {
    const c = openConsole();
    c.ctx.importDoc(newSong());
    await flush();
    expect(c.builds).toBe(1);
    expect(c.applied).toHaveLength(0);
  });
});

describe('a change landing while the system is being built (#629 review)', () => {
  it('queues a build from the merged document, so the edit is not left in the document only', async () => {
    const c = openConsole();
    c.host.enabled = false;
    c.host.building = true;
    expect(addPartLive(c.ctx)).toBe(1);
    expect(c.applied).toHaveLength(0);
    expect(c.model.doc.parts.map((p) => p.slot)).toEqual([0, 1]);
    await flush();
    expect(c.builds).toBe(1);
  });

  it("keeps the pending build's resume, where an import starts from the top (windsor#141)", () => {
    const c = openConsole();
    c.host.enabled = false;
    c.host.building = true;
    // A knob turned while an undo's rebuild is in flight re-syncs the edit
    // and asks the host to carry that rebuild's bar forward.
    expect(c.ctx.change({ transport: { bpm: 100 } } as DocumentPartial).ok).toBe(true);
    expect(c.buildOptions).toEqual([{ keepPendingResume: true }]);
    // A fresh document replaces the pending resume with none.
    c.ctx.importDoc(newSong());
    expect(c.buildOptions.at(-1)).toEqual({});
  });

  it('queues nothing while audio has never been enabled', () => {
    const c = openConsole();
    c.host.enabled = false;
    expect(c.ctx.change({ transport: { bpm: 100 } } as DocumentPartial).ok).toBe(true);
    expect(c.model.doc.transport.bpm).toBe(100);
    expect(c.builds).toBe(0);
  });
});

describe('the transport strip (#708)', () => {
  it('writes BPM, Bars, Key and Scale as live partials, never a rebuild', () => {
    const c = openConsole();
    c.ctx.render();
    for (const partial of [bpmChange(133), barsChange(8), keyChange(9), scaleChange('dorian')]) {
      if (!partial) throw new Error('a named scale must make a partial');
      expect(c.ctx.change(partial).ok).toBe(true);
    }
    // The Bars edit carries the ∞ region and the timeline's tail with it (#709 decision 4).
    expect(c.applied).toEqual([
      { transport: { bpm: 133 } },
      expect.objectContaining({ transport: { bars: 8 } }),
      { harmony: { root: 9 } },
      { harmony: { scale: 'dorian' } },
    ]);
    const { transport, harmony } = c.model.doc;
    expect([transport.bpm, transport.bars, harmony.root, harmony.scale]).toEqual([
      133,
      8,
      9,
      'dorian',
    ]);
    expect(c.builds).toBe(0);
  });

  it('renders the chrome on every render, whichever tab is active, and never on invalidate', () => {
    const c = openConsole();
    let strips = 0;
    c.ctx.addChrome(() => strips++);
    c.ctx.render();
    c.ctx.activate('mixer');
    c.ctx.render();
    c.ctx.activate('arrangement');
    expect(strips).toBe(2);
    c.ctx.invalidate();
    expect(strips).toBe(2);
    c.ctx.importDoc(newSong());
    expect(strips).toBe(3);
  });

  it('refreshTabs re-renders the active tab (a Bars edit) and leaves the chrome alone', () => {
    const c = openConsole();
    let strips = 0;
    c.ctx.addChrome(() => strips++);
    c.ctx.render();
    c.ctx.activate('song');
    const before = c.renders['song'] ?? 0;
    c.ctx.refreshTabs();
    expect(c.renders['song']).toBe(before + 1);
    expect(strips).toBe(1);
    c.ctx.activate('mixer');
    expect(c.renders['mixer']).toBe(1);
  });
});

describe('the Song view (#709)', () => {
  const BAR = TICKS_PER_BAR;

  it('writes a region edit as a live partial on the part, never a rebuild', () => {
    const c = openConsole();
    c.ctx.render();
    const regions = [
      { start: 0, duration: BAR },
      { start: 2 * BAR, duration: BAR },
    ];
    expect(c.ctx.change(partChange(0, { regions })).ok).toBe(true);
    expect(c.applied).toEqual([{ parts: { 0: { regions } } }]);
    expect(partAt(c.model.doc, 0)?.regions).toEqual(regions);
    expect(c.builds).toBe(0);
    expect(c.renders).toEqual({ parts: 1, mixer: 0, song: 0, arrangement: 0 });
  });

  it('writes a harmony edit as a live partial, the timeline kept contiguous by the normaliser', () => {
    const c = openConsole();
    c.ctx.render();
    const songTicks = c.model.doc.transport.bars * BAR;
    const events = appendEvent(c.model.doc.harmony.events, songTicks);
    expect(events.length).toBe(c.model.doc.harmony.events.length + 1);
    expect(c.ctx.change({ harmony: { events } }).ok).toBe(true);
    expect(c.applied).toEqual([{ harmony: { events } }]);
    expect(c.model.doc.harmony.events).toEqual(events);
    expect(c.builds).toBe(0);
  });

  it('round-trips a song edited only through the view: export, import, export byte-equal', () => {
    const c = openConsole();
    const songTicks = c.model.doc.transport.bars * BAR;
    c.ctx.change({ harmony: { events: appendEvent(c.model.doc.harmony.events, songTicks) } });
    c.ctx.change(
      partChange(0, {
        regions: [
          { start: 0, duration: BAR },
          { start: 2 * BAR, duration: 2 * BAR },
        ],
      }),
    );
    const exported = c.model.toJson();
    c.ctx.importDoc(JSON.parse(exported));
    expect(c.model.toJson()).toBe(exported);
    expect(c.model.corrections).toEqual([]);
  });

  it('carries a Bars edit through the whole-song region and the last event, and says so', () => {
    const c = openConsole();
    const grown = c.model.doc.transport.bars + 2;
    expect(c.ctx.change(barsChange(grown)).ok).toBe(true);
    expect(partAt(c.model.doc, 0)?.regions).toEqual([{ start: 0, duration: grown * BAR }]);
    const last = c.model.doc.harmony.events.at(-1);
    expect(last && last.start + last.duration).toBe(grown * BAR);
    expect(c.applied[0]?.parts?.[0]).toEqual({ regions: [{ start: 0, duration: grown * BAR }] });
    expect(c.status.at(-1)).toMatch(/^song length: .*refitted$/);
    expect(c.builds).toBe(0);
  });

  it("cuts a 12/8 song's whole-song region and harmony at its own bar (windsor#430)", () => {
    const c = openConsole();
    c.model.open(newSong('12/8'));
    const bar = ticksPerBar('12/8');
    expect(c.model.doc.transport.bars).toBe(4);
    expect(partAt(c.model.doc, 0)?.regions).toEqual([{ start: 0, duration: 4 * bar }]);
    expect(c.ctx.change(barsChange(3)).ok).toBe(true);
    // Three 144-tick bars end at 432, not at three 4/4 bars' 288.
    expect(partAt(c.model.doc, 0)?.regions).toEqual([{ start: 0, duration: 432 }]);
    const last = c.model.doc.harmony.events.at(-1);
    expect(last && last.start + last.duration).toBe(432);
  });

  it('cuts a meter change like a Bars edit, one undo step back (windsor#431)', () => {
    const c = openConsole();
    const regions = [
      { start: 0, duration: BAR },
      { start: 3 * BAR, duration: BAR },
    ];
    c.ctx.change(partChange(0, { regions }));
    const harmony = c.model.doc.harmony.events;
    expect(c.model.doc.transport.meter).toBeUndefined();
    const pick = meterChange('7/8');
    expect(pick && c.ctx.change(pick).ok).toBe(true);
    expect(c.model.doc.transport.meter).toBe('7/8');
    // Four 84-tick bars: every tick stays, and the last region is cut at 336.
    expect(songTicksOf(c.model.doc)).toBe(336);
    expect(partAt(c.model.doc, 0)?.regions).toEqual([regions[0], { start: 3 * BAR, duration: 48 }]);
    const last = c.model.doc.harmony.events.at(-1);
    expect(last && last.start + last.duration).toBe(336);
    expect(c.ctx.undo()).toBe(true);
    expect(c.model.doc.transport.meter).toBeUndefined();
    expect(partAt(c.model.doc, 0)?.regions).toEqual(regions);
    expect(c.model.doc.harmony.events).toEqual(harmony);
    expect(meterChange('9/8')).toBeNull();
  });
});
