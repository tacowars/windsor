/**
 * The console's application context (#620 decisions 1–3): the `AppCtx`
 * implementation `main.ts` used to hold inline. It owns the tab registry —
 * only the active tab is rendered, the rest are marked dirty and render when
 * shown, and a structural change or an import invalidates every tab through
 * one path (`rebuild`) — and the Parts tab's `PartsSession`, whose commit is
 * this context's document write. It knows no DOM beyond a panel's `hidden`
 * flag, so `appContext.test.ts` drives it with fakes.
 *
 * It also keeps the song's undo history (windsor#124; epic windsor#112;
 * record `2026-09-29-undo-history`): every song edit comes through `change`
 * (decision 1), which records one step, or one for a whole gesture. An undo
 * or a redo sends the live system the difference back, as an edit does, and
 * the model adopts the step's snapshot itself.
 */
import type {
  ApplyResult,
  ArrangementDocument,
  AudioPart,
  DocumentPartial,
  Patch,
} from '@windsor/engine';
import { partAt, songTicksOf } from '@windsor/engine';
import type { AppCtx, ConsoleTransport } from './context';
import { deepEqual, documentDiffLive } from './documentDiff';
import type { DocumentModel } from './documentModel';
import { setGestureHook } from './gestureHooks';
import type { BuildOptions, EngineHost } from './host';
import { loadRenames } from './partAutoName';
import { PartsSession } from './partsSession';
import { followSongLength } from './regionModel';
import type { OpenAmend } from './songSession';
import { SongSession } from './songSession';
import type { ToastTone } from './toastModel';
import { UndoHistory, stepLabel } from './undoHistory';

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

/** An open gesture (`beginGesture`): its name, its depth, and the document before its first change. */
interface Gesture {
  readonly label: string;
  depth: number;
  before: ArrangementDocument | null;
  tab: string | null;
}

export interface AppContextDeps {
  host: EngineHost;
  model: DocumentModel;
  notify: (message: string, tone?: ToastTone) => void;
}

export class AppContext<P extends TabPanel = HTMLElement> implements AppCtx {
  readonly host: EngineHost;
  readonly model: DocumentModel;
  readonly parts: PartsSession;
  readonly transport: ConsoleTransport;
  readonly notify: (message: string, tone?: ToastTone) => void;
  /** The open-song session (windsor#433); its storage is attached at boot. */
  readonly songs: SongSession;

  private readonly tabs = new Map<string, Tab<P>>();
  private active: string | null = null;
  /** Persistent chrome above every tab (the transport strip, #708): rendered on every `render()`. */
  private readonly chrome: Array<() => void> = [];
  private readonly history = new UndoHistory<ArrangementDocument>();
  private gesture: Gesture | null = null;
  /** Who follows each tab's shown state (`onTabShown`), by tab id. */
  private readonly shownListeners = new Map<string, Set<(shown: boolean) => void>>();

  constructor(deps: AppContextDeps) {
    this.host = deps.host;
    this.model = deps.model;
    this.notify = deps.notify;
    this.transport = deps.host.transport;
    this.parts = new PartsSession((patch) => this.commitPatch(patch));
    this.songs = new SongSession({
      model: this.model,
      parts: this.parts,
      replace: (raw, amend) => this.replaceDocument(raw, amend),
      change: (partial, label) => this.change(partial, label),
      notify: (message, tone) => this.notify(message, tone),
    });
    setGestureHook({ begin: (label) => this.beginGesture(label), end: () => this.endGesture() });
  }

  /** Register a tab; the first registered is the active one. Nothing renders until `render()`. */
  addTab(id: string, panel: P, render: (panel: P) => void): void {
    const before = this.active;
    this.active ??= id;
    panel.hidden = id !== this.active;
    this.tabs.set(id, { panel, render, dirty: true });
    this.announceShown(before);
  }

  /**
   * Follow whether tab `id` is shown (windsor#193 decision 4): `listener`
   * hears the state now and then on each change, until the returned call
   * stops it. What a view that works only while seen (the meters' loop)
   * starts and stops on, rather than polling its panel's `hidden`.
   */
  onTabShown(id: string, listener: (shown: boolean) => void): () => void {
    let listeners = this.shownListeners.get(id);
    if (!listeners) {
      listeners = new Set();
      this.shownListeners.set(id, listeners);
    }
    listeners.add(listener);
    listener(this.active === id);
    return () => void listeners.delete(listener);
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
    this.reveal(id);
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

  /**
   * A song edit: applied live, merged into the document, and recorded as one
   * undo step named `label` (by default its sections, `stepLabel`), or, inside
   * a gesture, folded into the gesture's step. A refused edit, or one that
   * leaves the document as it was, records nothing.
   */
  change(edit: DocumentPartial, label?: string): ApplyResult {
    const before = this.model.doc;
    const tab = this.active;
    // A Bars or meter edit carries every whole-song region and the timeline's
    // tail with it (#709 decision 4, windsor#431), so the strip and the
    // document agree on what ∞ means; any other partial passes through
    // unchanged. The refit folds into this edit's step (epic windsor#112
    // decision 7).
    const { partial, report } = followSongLength(before, edit);
    const result = this.commit(partial, report);
    if (result.ok) this.remember(before, label ?? stepLabel(edit), tab);
    return result;
  }

  /**
   * Open a gesture (a knob drag, a lane paint): every `change` until the
   * matching `endGesture` makes one step, named `label`. Nested begins count,
   * and only the outermost end records.
   */
  beginGesture(label: string): void {
    if (this.gesture) this.gesture.depth++;
    else this.gesture = { label, depth: 1, before: null, tab: null };
  }

  /** Close a gesture; the outermost end records its step, if the document changed. */
  endGesture(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    gesture.depth--;
    if (gesture.depth > 0) return;
    this.gesture = null;
    const { before, label, tab } = gesture;
    if (before && !deepEqual(before, this.model.doc)) {
      this.history.record({ before, label, tab });
    }
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** The name of the step an undo takes back ("Cutoff"), or null. */
  get undoLabel(): string | null {
    return this.history.undoLabel;
  }

  /** The name of the step a redo makes again, or null. */
  get redoLabel(): string | null {
    return this.history.redoLabel;
  }

  /** Listen for every change to the history (ticket 3's buttons); returns the unsubscribe. */
  onHistoryChange(listener: () => void): () => void {
    return this.history.onChange(listener);
  }

  /**
   * Step back: the document, live and in the model, as it was before the last
   * step, and the step's tab shown. False when nothing moved: an empty
   * history, a gesture still open, or the engine refusing.
   */
  undo(): boolean {
    const step = this.gesture ? null : this.history.nextUndo;
    const left = step && this.restore(step.before);
    if (!step || !left) return false;
    this.history.undone(left);
    this.show(step.tab);
    return true;
  }

  /** Step forward again through the last undone step; false when nothing moved, as for `undo`. */
  redo(): boolean {
    const step = this.gesture ? null : this.history.nextRedo;
    const left = step && this.restore(step.before);
    if (!step || !left) return false;
    this.history.redone(left);
    this.show(step.tab);
    return true;
  }

  /**
   * Adopt an imported document as an untitled song (windsor#433 decision
   * 5), through the session's one switch: the song being left is drained
   * into its record first, and when that fails the import stops, reported,
   * and resolves false. A song with no name takes `fileName`'s.
   */
  importDoc(raw: unknown, fileName?: string): Promise<boolean> {
    return this.songs.adopt(raw, fileName === undefined ? {} : { fileName });
  }

  /**
   * Replace the document — every switch of song takes this one path, from
   * the session. Through the model, never `makeArrangement` here: the model
   * is what applies the editor's library fill to a pre-#562 song.
   *
   * A generic part already playing a patch takes its name now (windsor#103
   * decision 4): a document edit like a typed rename, so it exports, made
   * inside `open` so the import report stays the raw document's; `amend` is
   * the session's own edit of the open (an imported file's name), made the
   * same way. The rebuild below builds from the amended document. A restore
   * or a stored song autosaves it only when the report is clean
   * (`saveOpenIfClean`); an import autosaves on open as it always has, and
   * its file is left untouched.
   */
  private replaceDocument(raw: unknown, amend?: OpenAmend): void {
    this.model.open(raw, (doc) => {
      const renames = loadRenames(doc);
      const own = amend?.(doc) ?? null;
      return renames || own ? { ...renames, ...own } : null;
    });
    // A new document starts a new history (decision 4). A gesture open
    // across it records nothing: its "before" belongs to the other song.
    this.history.clear();
    if (this.gesture) this.gesture.before = null;
    this.rebuild();
  }

  /** The working patch into the document under the selected part's preset name (a built-in forks). */
  private commitPatch(patch: Patch): boolean {
    const part = partAt(this.model.doc, this.parts.selected);
    if (!part) return false;
    return this.change({ patches: { [part.preset]: patch } }).ok;
  }

  /** The one path every edit takes: the live system first, then the document; a refusal is reported and changes nothing. */
  private commit(partial: DocumentPartial, report: readonly string[]): ApplyResult {
    const result = this.host.apply(partial);
    if (result && !result.ok) {
      this.refused(result);
      return result;
    }
    this.model.merge(partial);
    if (report.length > 0) this.notify(`song length: ${report.join(', ')} refitted`);
    if (result && result.ignored.length > 0)
      this.notify(`ignored: ${result.ignored.join(', ')}`, 'warning');
    // No system to apply to because one is being built (the first enable, an
    // Import, a Restart): that build captured an older document, so queue the
    // current one behind it — coalesced, latest wins — or a part added or
    // removed in that window would exist in the document only (#629 review,
    // passes 1 and 2). With audio never enabled there is nothing to queue.
    // It keeps the pending build's resume (windsor#141): an undo's bar
    // survives a knob turned before its system stands.
    if (result === null && this.host.isBuilding) this.rebuild({ keepPendingResume: true });
    return result ?? { ok: true, ignored: [] };
  }

  /**
   * An accepted edit's step: into the open gesture (only its first change
   * snapshots), or onto the history. `before` is the old document itself:
   * `merge` adopts a fresh one on every change, so nothing writes into it.
   */
  private remember(before: ArrangementDocument, label: string, tab: string | null): void {
    if (this.gesture) {
      if (this.gesture.before === null) {
        this.gesture.before = before;
        this.gesture.tab = tab;
      }
      return;
    }
    if (deepEqual(before, this.model.doc)) return;
    this.history.record({ before, label, tab });
  }

  private refused(result: ApplyResult): void {
    this.notify(`refused: ${result.error ?? 'invalid'}`, 'error');
  }

  /**
   * Turn the document into `target`, a step's snapshot, live first. The
   * model adopts the snapshot itself (`DocumentModel.replace`), so the
   * document is equal to it by construction. The live system is sent the
   * difference, an ordinary live partial, and is rebuilt from the snapshot
   * instead where no partial reaches it exactly: a part restored anywhere
   * but last, or a partial the engine ignored some of (epic decision 9
   * accepts the click); a transport playing across that rebuild plays on
   * from the bar it was in (windsor#132). Returns the document it replaced,
   * for the step's other stack, or null when the engine refused.
   */
  private restore(target: ArrangementDocument): ArrangementDocument | null {
    const current = this.model.doc;
    const { live, rebuild } = documentDiffLive(current, target, (raw) => this.model.preview(raw));
    const result = rebuild ? null : this.host.apply(live);
    if (result && !result.ok) {
      this.refused(result);
      return null;
    }
    this.model.replace(target);
    // With no system to apply to, a build in flight took an older document
    // and must be followed, as in `commit`; with audio never enabled there is
    // nothing to build.
    if (rebuild || (result ? result.ignored.length > 0 : this.host.isBuilding)) {
      // The song tick of the system still standing, in the song it was playing.
      this.buildLive({ resumeAt: this.transport.position() % songTicksOf(current) });
    }
    return current;
  }

  /** Show the tab a step was made on (epic decision 4) and draw what came back. */
  private show(tab: string | null): void {
    if (tab !== null && this.tabs.has(tab)) this.reveal(tab);
    this.render();
  }

  /** Make `id` the active tab and hide the rest, rendering nothing. */
  private reveal(id: string): void {
    const before = this.active;
    this.active = id;
    for (const [tabId, other] of this.tabs) other.panel.hidden = tabId !== id;
    this.announceShown(before);
  }

  /** Tell the tab hidden and the tab shown, if the active tab moved from `before`. */
  private announceShown(before: string | null): void {
    const now = this.active;
    if (now === before) return;
    if (before !== null)
      for (const listener of this.shownListeners.get(before) ?? []) listener(false);
    if (now !== null) for (const listener of this.shownListeners.get(now) ?? []) listener(true);
  }

  /** The one path a structural change takes: the live system rebuilt, every tab invalidated. */
  private rebuild(options: BuildOptions = {}): void {
    this.buildLive(options);
    this.render();
  }

  /**
   * The live system rebuilt from the document, and every tab drawn again once
   * it stands. `EngineHost.build` rebuilds at tick 0: a transport playing
   * across it plays on from the top of the song (`HostTransport.adopt`), or,
   * for an undo or redo, from the bar `options.resumeAt` names.
   */
  private buildLive(options: BuildOptions = {}): void {
    void this.host.build(this.model.doc, options).then(
      () => this.render(),
      (error: unknown) => this.notify(String(error), 'error'),
    );
  }

  private renderTab(tab: Tab<P>): void {
    tab.dirty = false;
    tab.render(tab.panel);
  }
}
