/**
 * The application context over fakes (#620 decisions 1–3): a host that
 * accepts every change and builds instantly, panels that are nothing but a
 * `hidden` flag, and renderers that count. What the tests pin is the render
 * discipline — only the active tab renders on a change, a hidden tab renders
 * once when shown, a structural change or an import invalidates every tab —
 * and the session's commit landing in the document under the selected
 * part's preset.
 */
import { describe, expect, it } from 'vitest';

import type {
  ApplyResult,
  AudioPart,
  DocumentPartial,
} from '../../../packages/client/src/audio/index-for-editor';
import { makePatch, partAt } from '../../../packages/client/src/audio/index-for-editor';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import { newSong } from './songParts';

const TAB_IDS = ['parts', 'mixer', 'sequencers', 'harmony', 'arrangement'] as const;

interface Console {
  ctx: AppContext<TabPanel>;
  model: DocumentModel;
  renders: Record<string, number>;
  panels: Record<string, TabPanel>;
  status: string[];
  applied: DocumentPartial[];
  builds: number;
  /** The live parts the fake host hands out by slot, once "enabled". */
  liveParts: Map<number, AudioPart>;
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
    liveParts: new Map(),
  };
  const host: ContextHost = {
    apply: (partial): ApplyResult => {
      applied.push(partial);
      return refuse ? { ok: false, ignored: [], error: 'nope' } : { ok: true, ignored: [] };
    },
    build: () => {
      console.builds++;
      return Promise.resolve();
    },
    capturePattern: () => null,
    part: (slot) => console.liveParts.get(slot) ?? null,
  };
  console.ctx = new AppContext<TabPanel>({
    host: host as EngineHost,
    model: console.model,
    status: (message) => status.push(message),
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
    expect(c.renders).toEqual({ parts: 1, mixer: 0, sequencers: 0, harmony: 0, arrangement: 0 });
    expect(c.panels['parts']?.hidden).toBe(false);
    expect(TAB_IDS.filter((id) => id !== 'parts').every((id) => c.panels[id]?.hidden)).toBe(true);
  });

  it('renders only the active tab on a change after a restructure', async () => {
    const c = openConsole();
    c.ctx.render();
    c.ctx.restructure(() => undefined);
    await flush();
    // Once for the draft, once when the live rebuild landed — the active tab only.
    expect(c.builds).toBe(1);
    expect(c.renders).toEqual({ parts: 3, mixer: 0, sequencers: 0, harmony: 0, arrangement: 0 });
    const result = c.ctx.change({ bpm: 120 } as DocumentPartial);
    c.ctx.render();
    expect(result.ok).toBe(true);
    expect(c.applied).toHaveLength(1);
    expect(c.renders).toEqual({ parts: 4, mixer: 0, sequencers: 0, harmony: 0, arrangement: 0 });
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

  it('invalidates every tab on an import', async () => {
    const c = openConsole();
    for (const id of TAB_IDS) c.ctx.activate(id);
    c.ctx.activate('harmony');
    const before = { ...c.renders };
    c.ctx.importDoc(newSong());
    await flush();
    expect(c.renders['harmony']).toBe((before['harmony'] ?? 0) + 2);
    for (const id of TAB_IDS) {
      if (id !== 'harmony') expect(c.renders[id], id).toBe(before[id]);
    }
    for (const id of TAB_IDS) c.ctx.activate(id);
    for (const id of TAB_IDS) {
      if (id !== 'harmony') expect(c.renders[id], id).toBe((before[id] ?? 0) + 1);
    }
  });
});

describe('AppContext changes and the parts session', () => {
  it('merges an accepted change and reports a refused one without merging', () => {
    const accepted = openConsole();
    expect(accepted.ctx.change({ bpm: 133 } as DocumentPartial).ok).toBe(true);
    expect(accepted.model.doc.bpm).toBe(133);

    const refused = openConsole(true);
    const bpm = refused.model.doc.bpm;
    expect(refused.ctx.change({ bpm: 133 } as DocumentPartial).ok).toBe(false);
    expect(refused.model.doc.bpm).toBe(bpm);
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
