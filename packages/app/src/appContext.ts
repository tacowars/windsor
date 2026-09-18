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
import type { AppCtx } from './context';
import { partChange } from './context';
import type { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import { PartsSession } from './partsSession';

/** The part of the engine host the context drives; a test's fake implements this much. */
export type ContextHost = Pick<EngineHost, 'apply' | 'build' | 'capturePattern' | 'part'>;

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
  readonly status: (message: string) => void;

  private readonly tabs = new Map<string, Tab<P>>();
  private active: string | null = null;

  constructor(deps: AppContextDeps) {
    this.host = deps.host;
    this.model = deps.model;
    this.status = deps.status;
    this.parts = new PartsSession((patch) => this.commitPatch(patch));
  }

  /** Register a tab; the first registered is the active one. Nothing renders until `render()`. */
  addTab(id: string, panel: P, render: (panel: P) => void): void {
    this.active ??= id;
    panel.hidden = id !== this.active;
    this.tabs.set(id, { panel, render, dirty: true });
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

  /** Every tab is out of date; the active one catches up now, the others when shown. */
  render(): void {
    for (const tab of this.tabs.values()) tab.dirty = true;
    const active = this.active === null ? undefined : this.tabs.get(this.active);
    if (active) this.renderTab(active);
  }

  change(partial: DocumentPartial): ApplyResult {
    const live = this.host.apply(partial);
    if (live && !live.ok) {
      this.status(`refused: ${live.error ?? 'invalid'}`);
      return live;
    }
    this.model.merge(partial);
    if (live && live.ignored.length > 0) this.status(`ignored: ${live.ignored.join(', ')}`);
    return live ?? { ok: true, ignored: [] };
  }

  restructure(edit: (draft: Record<string, unknown>) => void): void {
    this.model.mutate(edit);
    this.rebuild();
  }

  importDoc(raw: unknown): void {
    // Through the model, never `makeArrangement` here: the model is what
    // applies the editor's library fill to a pre-#562 song.
    this.model.open(raw);
    this.rebuild();
  }

  capture(slot: number): boolean {
    const pattern = this.host.capturePattern(slot);
    if (!pattern) return false;
    const result = this.change(partChange(slot, { sequencer: { pattern } }));
    if (result.ok) {
      this.status(
        `part ${slot}: captured — the sounding bar is now a literal array in the document`,
      );
      this.render();
    }
    return result.ok;
  }

  release(slot: number): void {
    const result = this.change(partChange(slot, { sequencer: { pattern: null } }));
    if (result.ok) {
      this.status(`part ${slot}: released back to generative`);
      this.render();
    }
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
