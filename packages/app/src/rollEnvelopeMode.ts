/**
 * The Roll card's Envelopes tab, wired to one device (windsor#707; epic
 * windsor#699; the approved mockup `docs/design/roll-envelopes-mockup.html`
 * and its "Decided" list):
 *
 * - the tab row's Notes · Envelopes picks the view's page
 *   (`rollView.ts`), kept for the session and never written to the song;
 * - on Envelopes, the controls column (`rollEnvelopeColumn.ts`) takes the
 *   note controls' place, with the roll's one Snap moved to its head, and
 *   the layer (`rollEnvelopeOverlay.ts`) covers the note pane: the notes
 *   dim and take no pointer, and the velocity lane is as it was;
 * - the picker's list (`rollEnvelopeList.ts`) over the rules in
 *   `rollEnvelopePicker.ts` adds an empty envelope, or shows one the roll
 *   has; the switch and ✕ switch it and delete it. Each write is one undo
 *   step through the roll editor (`RollEditor.commitEnvelopes`);
 * - the tools (`rollEnvelopeEditing.ts`, windsor#708) edit the shown
 *   envelope on the layer's lane with the Song tab's gestures and Shape
 *   tool, and E, D and S pick them (`rollEnvelopeKeys.ts`).
 *
 * Notes is today's tab, unchanged. The device calls `paint` after each
 * whole paint of the roll and `scrolled` on each scroll of the notes.
 */
import type { RollEnvelope, RollEnvelopePoint } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import type { RollControls } from './rollControls';
import type { RollEditor } from './rollEditor';
import {
  type EnvelopeColumnActions,
  type EnvelopeColumnState,
  envelopeColumn,
} from './rollEnvelopeColumn';
import { type ShownEnvelope, envelopeEditing } from './rollEnvelopeEditing';
import type { RollEnvelopeFrame } from './rollEnvelopeHost';
import { envelopeKeys } from './rollEnvelopeKeys';
import { type EnvelopeList, openEnvelopeList } from './rollEnvelopeList';
import { envelopeLayer } from './rollEnvelopeOverlay';
import {
  type EnvelopeTargetGroup,
  envelopePicker,
  shownEnvelope,
  switchedEnvelope,
  targetName,
  targetSection,
  voiceTargetGroups,
  withEnvelope,
  withoutEnvelope,
} from './rollEnvelopePicker';
import { ROLL_ENVELOPE_UNDO as UNDO, type RollPage } from './rollEnvelopeTables';
import type { RollTabs } from './rollEnvelopeTabs';
import { withEnvelopePoints } from './rollEnvelopeSettle';
import { envelopesOf } from './rollEnvelopeWrite';
import { type RollPanes, forwardWheel } from './rollPanes';
import type { RollScene } from './rollScene';
import type { RollViewState } from './rollView';
import type { AutomationTool } from './songAutomationTables';
import type { ShapeTool } from './songShapeRange';

/** What the device hands its Envelopes tab. */
export interface EnvelopeModeHost {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
  /** The device's body, which carries `env-on` while Envelopes shows. */
  readonly body: HTMLElement;
  readonly panes: RollPanes;
  readonly view: RollViewState;
  readonly tabs: RollTabs;
  readonly controls: RollControls;
  readonly editor: RollEditor;
  /** Whether the card is still the page's: false once it is torn down or replaced. */
  attached(): boolean;
  /** The last paint's scene. */
  scene(): RollScene | null;
}

/** What the column was last drawn from. */
interface Read {
  readonly groups: readonly EnvelopeTargetGroup[];
  readonly envelopes: readonly RollEnvelope[];
  readonly state: EnvelopeColumnState;
}

/** One device's Envelopes tab. */
export class RollEnvelopeMode {
  private readonly layer = envelopeLayer();
  private readonly column = envelopeColumn();
  private list: EnvelopeList | null = null;
  private readonly shape: ShapeTool;
  /** The shown envelope's target, named, as the last render read it. */
  private shownName = '';
  private readonly actions: EnvelopeColumnActions = {
    toggleList: (anchor) => (this.list ? this.list.close() : this.openList(anchor)),
    switchShown: () => {
      const { envelopes, state } = this.read();
      if (!state.shown) return;
      const label = UNDO.on(state.name, !state.shown.on);
      this.host.editor.commitEnvelopes(switchedEnvelope(envelopes, state.shown.target), label);
    },
    deleteShown: () => {
      const { envelopes, state } = this.read();
      if (!state.shown) return;
      this.shape.close();
      const next = withoutEnvelope(envelopes, state.shown.target);
      this.host.view.envelope.shown = next[0]?.target ?? null;
      this.host.editor.commitEnvelopes(next, UNDO.remove(state.name));
    },
    pickTool: (tool) => this.pickTool(tool),
  };

  constructor(private readonly host: EnvelopeModeHost) {
    host.controls.root.appendChild(this.column.root);
    host.panes.root.appendChild(this.layer.root);
    this.layer.root.addEventListener('wheel', (e) => forwardWheel(host.panes.body, e), {
      passive: false,
    });
    host.tabs.onPick = (page) => this.show(page);
    this.shape = envelopeEditing({
      view: host.view,
      layer: this.layer,
      container: host.body,
      viewport: host.panes.body,
      frame: () => this.frame(),
      shown: () => this.shownEnvelope(),
      write: (points, label) => this.write(points, label),
      hover: (text) => this.column.value(text),
    });
    envelopeKeys({
      showing: () => this.on && host.attached() && host.body.closest('[hidden]') === null,
      pick: (tool) => this.pickTool(tool),
    });
  }

  private get on(): boolean {
    return this.host.view.page === 'envelopes';
  }

  private show(page: RollPage): void {
    if (page === this.host.view.page) return;
    this.host.view.page = page;
    this.paint();
  }

  /** Show the page the view is on: its tab, its column and, on Envelopes, the layer. */
  paint(): void {
    const { view, tabs, controls, body } = this.host;
    const on = this.on;
    tabs.show(view.page);
    body.classList.toggle('env-on', on);
    controls.cols.hidden = on;
    this.column.root.hidden = !on;
    this.layer.root.hidden = !on;
    // One Snap, the roll's, first in whichever column shows.
    const home = on ? this.column.root : controls.cols.firstElementChild;
    if (home && controls.snap.parentElement !== home) home.prepend(controls.snap);
    if (on) this.render();
    else {
      this.list?.close();
      this.shape.close();
    }
  }

  /** A tool picked, by its button or its key: anything but Shape closes the Shape popover. */
  private pickTool(tool: AutomationTool): void {
    this.host.view.envelope.tool = tool;
    this.shape.toolChanged();
    this.render();
  }

  /** The roll's frame for the tools: the last paint's scene, the pane's height, the song's meter. */
  private frame(): RollEnvelopeFrame {
    const { scene, panes, ctx } = this.host;
    const drawn = scene();
    return {
      pxPerTick: drawn?.pxPerTick ?? 1,
      loopTicks: drawn?.loopTicks ?? 0,
      regionTicks: drawn?.regionTicks ?? 0,
      heightPx: panes.body.clientHeight,
      meter: ctx.model.doc.transport.meter,
    };
  }

  /** The envelope the tools edit, as the document holds it now. */
  private shownEnvelope(): ShownEnvelope | null {
    const { ctx, slot, region, view } = this.host;
    const envelope = shownEnvelope(envelopesOf(ctx.model.doc, slot, region), view.envelope.shown);
    return envelope ? { envelope, name: this.shownName } : null;
  }

  /** Write the shown envelope's points, one undo step. */
  private write(points: readonly RollEnvelopePoint[], label: string): void {
    const shown = this.shownEnvelope();
    if (!shown) return;
    const { ctx, slot, region, editor } = this.host;
    const envelopes = envelopesOf(ctx.model.doc, slot, region);
    editor.commitEnvelopes(withEnvelopePoints(envelopes, shown.envelope.target, points), label);
  }

  /** Keep the list open only while `on`: the card on the page and shown. Returns `on`. */
  keepList(on: boolean): boolean {
    if (!on) this.list?.close();
    return on;
  }

  /** Keep the curve on the notes' sideways scroll. */
  scrolled(): void {
    if (this.on) this.layer.scroll(this.host.panes.body.scrollLeft);
  }

  /** The document's envelopes for the region, and the column's state over them. */
  private read(): Read {
    const { ctx, slot, region, view } = this.host;
    const doc = ctx.model.doc;
    const part = partAt(doc, slot);
    const groups = part ? voiceTargetGroups(part, doc.patches?.[part.preset]) : [];
    const envelopes = envelopesOf(doc, slot, region);
    const shown = shownEnvelope(envelopes, view.envelope.shown);
    const picker = envelopePicker({
      groups,
      envelopes,
      part,
      shown: shown?.target ?? null,
    });
    const state: EnvelopeColumnState = {
      picker,
      shown,
      name: shown ? targetName(groups, shown.target) : '',
      section: shown ? targetSection(groups, shown.target) : '',
      tool: view.envelope.tool,
      listOpen: this.list !== null,
    };
    return { groups, envelopes, state };
  }

  /** Redraw the column and the layer from the document. */
  private render(): void {
    const { state } = this.read();
    this.shownName = state.name;
    this.column.render(state, this.actions);
    const scene = this.host.scene();
    const { body } = this.host.panes;
    if (!scene) return;
    this.layer.paint({
      envelope: state.shown,
      scene,
      tool: state.tool,
      widthPx: body.clientWidth,
      heightPx: body.clientHeight,
      scrollLeft: body.scrollLeft,
    });
    // The Shape tool forgets a lane it finds off the page; the device paints before it is placed.
    if (this.layer.lane.isConnected) this.shape.refresh();
  }

  private openList(anchor: HTMLElement): void {
    const { state } = this.read();
    this.list = openEnvelopeList(anchor, state.picker, {
      live: () => this.host.attached(),
      pick: (path) => this.pick(path),
      closed: () => {
        this.list = null;
        if (this.on && this.host.attached()) this.render();
      },
    });
    anchor.setAttribute('aria-expanded', 'true');
  }

  /** A target picked in the list: show its envelope, or add an empty one and show it. */
  private pick(path: string): void {
    const { groups, envelopes, state } = this.read();
    const { view, editor } = this.host;
    if (path !== view.envelope.shown) this.shape.close();
    if (envelopes.some((envelope) => envelope.target === path)) {
      view.envelope.shown = path;
      this.render();
      return;
    }
    const target = state.picker.groups
      .flatMap((group) => group.targets)
      .find((t) => t.path === path);
    if (!target || target.refused) return;
    view.envelope.shown = path;
    const label = UNDO.add(targetName(groups, path));
    editor.commitEnvelopes(withEnvelope(envelopes, target.path), label);
  }
}
