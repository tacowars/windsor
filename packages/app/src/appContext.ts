/**
 * The console's application context (#620 decisions 1–3): the `AppCtx`
 * implementation `main.ts` used to hold inline. It owns the tab registry —
 * only the active tab is rendered, the rest are marked dirty and render when
 * shown, and a structural change or an import invalidates every tab through
 * one path (`rebuild`) — and the Parts tab's `PartsSession`, whose commit is
 * this context's document write. It knows no DOM beyond a panel's `hidden`
 * flag, so `appContext.test.ts` drives it with fakes.
 */
import type {
  ApplyResult,
  AudioPart,
  DocumentPartial,
  Patch,
} from '../../../packages/client/src/audio/index-for-editor';
import { partAt } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx, ConsoleTransport } from './context';
import type { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import { PartsSession } from './partsSession';
import { followSongLength } from './regionModel';

/** The part of the engine host the context drives; a test's fake implements this much. */
export type ContextHost = Pick<
  EngineHost,
  'apply' | 'build' | 'isBuilding' | 'capturePattern' | 'part'
>;

/** A tab's panel: an element, or a test's stand-in with the one flag the context flips. */
export interface TabPanel {
  hidden: boolean;
}

interface Tab<P extends TabPanel> {
  panel: P;
  render: (panel: P) => void;
  dirty: boolean;
}

export interface AppContextDeps {
  host: EngineHost;
  model: DocumentModel;
  status: (message: string) => void;
}

export class AppContext<P extends TabPanel = HTMLElement> implements AppCtx {
  readonly host: EngineHost;
  readonly model: DocumentModel;
  readonly parts: PartsSession;
  readonly transport: ConsoleTransport;
  readonly status: (message: string) => void;

  private readonly tabs = new Map<string, Tab<P>>();
  private active: string | null = null;
  /** Persistent chrome above every tab (the transport strip, #708): rendered on every `render()`. */
  private readonly chrome: Array<() => void> = [];

  constructor(deps: AppContextDeps) {
    this.host = deps.host;
    this.model = deps.model;
    this.status = deps.status;
    this.transport = deps.host.transport;
    this.parts = new PartsSession((patch) => this.commitPatch(patch));
  }

  /** Register a tab; the first registered is the active one. Nothing renders until `render()`. */
  addTab(id: string, panel: P, render: (panel: P) => void): void {
    this.active ??= id;
    panel.hidden = id !== this.active;
    this.tabs.set(id, { panel, render, dirty: true });
  }

  /**
   * Register chrome that sits above every tab panel (#708): it re-renders on
   * every `render()` — an import, a key change on the Harmony tab — and never
   * on `invalidate()`, so a knob in it survives its own drag.
   */
  addChrome(render: () => void): void {
    this.chrome.push(render);
  }

  get activeTab(): string | null {
    return this.active;
  }

  /**
   * The live part the selected slot plays, resolved at the call: the keyboard
   * and a MIDI controller audition through it, and it must follow an enable
   * or a rebuild even while the Parts tab is hidden and its render deferred.
   */
  livePart(): AudioPart | null {
    const part = partAt(this.model.doc, this.parts.selected);
    return part ? this.host.part(part.slot) : null;
  }

  /** Show `id`, hide the rest, and render it if a change landed while it was hidden. */
  activate(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.active = id;
    for (const [tabId, other] of this.tabs) other.panel.hidden = tabId !== id;
    if (tab.dirty) this.renderTab(tab);
  }

  /** Every tab but the active one is out of date: a control that must survive its own gesture calls this, not `render`. */
  invalidate(): void {
    for (const [id, tab] of this.tabs) if (id !== this.active) tab.dirty = true;
  }

  /** Every tab is out of date; the active one catches up now, the others when shown. */
  render(): void {
    for (const renderChrome of this.chrome) renderChrome();
    this.refreshTabs();
  }

  /** Every tab is out of date and the active one catches up now; the chrome is left alone. */
  refreshTabs(): void {
    for (const tab of this.tabs.values()) tab.dirty = true;
    const active = this.active === null ? undefined : this.tabs.get(this.active);
    if (active) this.renderTab(active);
  }

  change(edit: DocumentPartial): ApplyResult {
    // A Bars edit carries every whole-song region and the timeline's tail
    // with it (#709 decision 4), so the strip's knob and the document agree
    // on what ∞ means; any other partial passes through unchanged.
    const { partial, report } = followSongLength(this.model.doc, edit);
    const live = this.host.apply(partial);
    if (live && !live.ok) {
      this.status(`refused: ${live.error ?? 'invalid'}`);
      return live;
    }
    this.model.merge(partial);
    if (report.length > 0) this.status(`song length: ${report.join(', ')} refitted`);
    if (live && live.ignored.length > 0) this.status(`ignored: ${live.ignored.join(', ')}`);
    // No system to apply to because one is being built (the first enable, an
    // Import, a Restart): that build captured an older document, so queue the
    // current one behind it — coalesced, latest wins — or a part added or
    // removed in that window would exist in the document only (#629 review,
    // passes 1 and 2). With audio never enabled there is nothing to queue.
    if (live === null && this.host.isBuilding) this.rebuild();
    return live ?? { ok: true, ignored: [] };
  }

  importDoc(raw: unknown): void {
    // Through the model, never `makeArrangement` here: the model is what
    // applies the editor's library fill to a pre-#562 song.
    this.model.open(raw);
    this.rebuild();
  }

  /** The working patch into the document under the selected part's preset name (a built-in forks). */
  private commitPatch(patch: Patch): boolean {
    const part = partAt(this.model.doc, this.parts.selected);
    if (!part) return false;
    return this.change({ patches: { [part.preset]: patch } }).ok;
  }

  /** The one path a structural change takes: the live system rebuilt, every tab invalidated. */
  private rebuild(): void {
    void this.host.build(this.model.doc).then(
      () => this.render(),
      (error: unknown) => this.status(String(error)),
    );
    this.render();
  }

  private renderTab(tab: Tab<P>): void {
    tab.dirty = false;
    tab.render(tab.panel);
  }
}
