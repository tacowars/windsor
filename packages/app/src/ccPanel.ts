/**
 * The MIDI CC panel (windsor#784, record `2026-10-13-midi-cc-mapping` decision
 * 12, built to the approved mockup): a popover under the Parts tab's part bar,
 * opened by its MIDI CC button, listing the mappings with the columns Part,
 * Parameter, Source, Range, Inv, Live, Learn and Delete, This part or All
 * parts, "+ Add mapping" into learn, Pickup | Jump and Reset performance.
 *
 * It is one element on the page, outside every tab, so a bar rebuilt under it
 * or another tab's "Edit mapping…" (`ccPanelEntry.ts`) opens the same one. It
 * draws from `CcSession` and the document through `ccPanelModel.ts`; a CC
 * value moving repaints only the Live cells, once a frame. A drag, a typed
 * value or a focused select holds the redraw until it lets go. Every mapping
 * edit is one `ctx.change`, one undo step.
 */
import type { CcMapping, CcTargetId } from '@windsor/engine';
import { partAt } from '@windsor/engine';

import { CC_HEARD_MS, CC_POP_GAP_PX, CC_ROW_FLASH_MS } from './ccPanelConstants';
import type { CcRangeEnd } from './ccPanelEdits';
import { withInverted, withRangeEnd, withSource, withoutMapping } from './ccPanelEdits';
import { ccFoot, ccHead, ccOffBanner } from './ccPanelFrame';
import { type CcFilter, type CcRowView, ccMappingCount, ccRows } from './ccPanelModel';
import { ccTargetPicker } from './ccPanelPicker';
import { type CcRowActions, ccHeadRow, ccRow, paintLive } from './ccPanelRow';
import { CC_EDIT_LABEL, type CcSession, ccMappingsChange } from './ccPanelSession';
import { ccTargetList, ccVoiceCount } from './ccPanelTargets';
import { partPatch } from './ccPanelEngine';
import { writeTakeover } from './ccTakeover';
import type { AppCtx } from './context';
import { el } from './dom';
import type { MidiAccessor } from './midiAccess';

const PICK_HINT = 'Pick a parameter, then move a knob on your controller.';
const OFF_HINT = 'Enable MIDI to add a mapping.';

export class CcPanel {
  private shown = false;
  private filter: CcFilter = 'this';
  private picking = false;
  private holding = false;
  private stale = false;
  private frame = 0;
  private heardTimer: ReturnType<typeof setTimeout> | undefined;
  /** The heard source the timer runs for. */
  private heardTimed: object | null = null;
  private readonly root = el('div', 'cc-pop');
  private anchor: HTMLElement | null = null;
  private lives = new Map<string, { cell: HTMLElement; heard: string | null }>();

  constructor(
    private readonly ctx: AppCtx,
    private readonly session: CcSession,
    private readonly midi: MidiAccessor,
  ) {
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'MIDI CC mappings');
    this.root.addEventListener('focusout', () => queueMicrotask(() => this.catchUp()));
    document.body.append(this.root);
    session.onChange((change) => (change === 'live' ? this.queueLive() : this.redraw()));
    midi.watch(() => this.redraw());
    ctx.parts.onSelect(() => {
      this.picking = false;
      this.redraw();
    });
    document.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('pointerdown', (e) => this.outside(e), true);
    window.addEventListener('resize', () => this.place());
    // The page scrolls in the console, not the document: the panel is placed
    // in the window, so it follows the part bar as the console scrolls.
    document
      .getElementById('console')
      ?.addEventListener('scroll', () => this.place(), { passive: true });
  }

  /** A MIDI CC button for the part bar, with the selected part's mapping count. */
  button(): HTMLElement {
    const b = el('button', 'btn cc-btn', 'MIDI CC ') as HTMLButtonElement;
    b.type = 'button';
    b.id = 'ccPanelButton';
    b.title = "Map your controller's knobs to this part's parameters";
    b.setAttribute('aria-haspopup', 'dialog');
    b.append(el('span', 'cc-count'));
    b.onclick = (): void => (this.shown ? this.hide() : this.show());
    this.anchor = b;
    this.syncButton();
    return b;
  }

  /** Open the panel at the mapping on `target` of `part`, and light its row. */
  openAt(part: number, target: CcTargetId): void {
    if (part !== this.ctx.parts.selected) this.filter = 'all';
    this.show();
    const row = this.root.querySelector<HTMLElement>(`.cc-row[data-key="${part}|${target}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    row?.classList.add('flash');
    setTimeout(() => row?.classList.remove('flash'), CC_ROW_FLASH_MS);
  }

  /** Open the panel and listen for a knob for `target` of `part`; with MIDI off, only open it. */
  learnFor(part: number, target: CcTargetId): void {
    if (part !== this.ctx.parts.selected) this.filter = 'all';
    this.show();
    if (this.midi.state === 'ready') this.session.learn(part, target);
  }

  show(): void {
    this.shown = true;
    this.root.hidden = false;
    this.render();
    this.place();
  }

  /** Close, leaving nothing of a learn or a pick behind. */
  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.picking = false;
    this.root.hidden = true;
    this.session.cancelLearn();
    this.syncButton();
  }

  /** The button's count and state, wherever the bar put it. */
  private syncButton(): void {
    const b = this.anchor;
    if (!b) return;
    b.setAttribute('aria-expanded', String(this.shown));
    const count = b.querySelector('.cc-count');
    if (count)
      count.textContent = String(ccMappingCount(this.ctx.model.doc, this.ctx.parts.selected));
  }

  /**
   * Under the part bar when it shows, else under the top of the tabs, and no
   * taller than the window below that, the same gap short of its foot: a
   * longer list scrolls inside the panel.
   */
  private place(): void {
    if (!this.shown) return;
    const bar = this.anchor?.isConnected ? this.anchor.closest('.patch-bar') : null;
    const shownBar = bar && bar.closest('[hidden]') === null ? bar : null;
    const over = shownBar ?? document.getElementById('tabRoot');
    const rect = over?.getBoundingClientRect();
    const top = (rect ? (shownBar ? rect.bottom : rect.top) : 0) + CC_POP_GAP_PX;
    this.root.style.top = `${top}px`;
    this.root.style.maxHeight = `calc(100dvh - ${top + CC_POP_GAP_PX}px)`;
  }

  /** Something the rows are drawn from changed: the button now, the panel when nothing holds it. */
  private redraw(): void {
    this.syncButton();
    this.expireHeard();
    if (this.shown) this.render();
  }

  /** A row learn just committed reads "Heard …" for a while, then its source. */
  private expireHeard(): void {
    const heard = this.session.heard;
    if (heard === this.heardTimed) return;
    this.heardTimed = heard;
    clearTimeout(this.heardTimer);
    if (heard) this.heardTimer = setTimeout(() => this.session.clearHeard(), CC_HEARD_MS);
  }

  /** Whether something inside is mid-edit: a drag, a typed value, a focused select. */
  private held(): boolean {
    const active = document.activeElement;
    const editing =
      active instanceof HTMLElement &&
      this.root.contains(active) &&
      active.matches('select, input');
    return this.holding || editing;
  }

  private catchUp(): void {
    if (this.stale && !this.held()) this.render();
  }

  private render(): void {
    if (this.held()) {
      this.stale = true;
      return;
    }
    this.stale = false;
    const doc = this.ctx.model.doc;
    const selected = this.ctx.parts.selected;
    const midiOn = this.midi.state === 'ready';
    const connected = this.midi.inputs().flatMap((i) => (i.connected ? [i.name] : []));
    const grid = el('div', 'cc-grid');
    grid.append(ccHeadRow());
    this.lives = new Map();
    const rows = ccRows(doc, this.filter, selected, this.session);
    const context = { midiOn, connected, actions: this.actions() };
    for (const view of rows) {
      const { row, live } = ccRow(view, context);
      grid.append(row);
      const heard = view.source.kind === 'set' ? view.source.heardLine : null;
      this.lives.set(view.key, { cell: live, heard });
    }
    if (rows.length === 0) grid.append(el('div', 'cc-empty', this.emptyText()));
    this.root.replaceChildren(
      ccHead({
        filter: () => this.filter,
        setFilter: (filter) => {
          this.filter = filter;
          this.render();
        },
        takeover: () => this.session.takeover,
        setTakeover: (takeover) => {
          this.session.takeover = takeover;
          writeTakeover(takeover);
        },
        reset: () => this.session.resetPerformance(),
        close: () => this.hide(),
      }),
      ...(midiOn
        ? []
        : [ccOffBanner(this.midi.state, this.midi.error, () => void this.midi.enable())]),
      grid,
      this.foot(midiOn),
    );
    this.syncButton();
  }

  private emptyText(): string {
    return this.filter === 'all'
      ? 'No part has a mapping yet.'
      : 'This part has no mapping yet. + Add mapping, then move a knob on your controller.';
  }

  private foot(midiOn: boolean): HTMLElement {
    const doc = this.ctx.model.doc;
    const part = partAt(doc, this.ctx.parts.selected);
    const list = part ? ccTargetList(part, partPatch(doc, part)) : null;
    const picker =
      this.picking && list
        ? ccTargetPicker(list, (target) => {
            this.picking = false;
            this.session.learn(this.ctx.parts.selected, target);
          })
        : null;
    const view = {
      canAdd: midiOn && part !== undefined,
      picking: picker !== null,
      count: part && list ? `${ccVoiceCount(list.used, list.max)} · ${part.name}` : '',
      full: list?.full ?? false,
      hint: midiOn ? PICK_HINT : OFF_HINT,
    };
    return ccFoot(view, () => this.togglePicking(), picker);
  }

  private togglePicking(): void {
    this.picking = !this.picking;
    if (this.picking) this.session.cancelLearn();
    this.render();
  }

  /** Repaint the Live cells next frame; a new "heard" line needs the whole panel. */
  private queueLive(): void {
    if (!this.shown || this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.midi.state !== 'ready') return;
      const rows = ccRows(this.ctx.model.doc, this.filter, this.ctx.parts.selected, this.session);
      for (const view of rows) {
        const known = this.lives.get(view.key);
        const heard = view.source.kind === 'set' ? view.source.heardLine : null;
        if (!known || known.heard !== heard) {
          this.render();
          return;
        }
        paintLive(known.cell, view.live);
      }
    });
  }

  /** The row controls' edits, each one song edit. */
  private actions(): CcRowActions {
    const edit = (row: CcRowView, next: (list: readonly CcMapping[]) => CcMapping[]): void => {
      const list = partAt(this.ctx.model.doc, row.part)?.ccMappings ?? [];
      this.ctx.change(ccMappingsChange(row.part, next(list)), CC_EDIT_LABEL);
    };
    return {
      device: (row, device) => edit(row, (list) => withSource(list, row.target, { device })),
      channel: (row, channel) => edit(row, (list) => withSource(list, row.target, { channel })),
      invert: (row) => edit(row, (list) => withInverted(list, row.target)),
      learn: (row) => this.session.learn(row.part, row.target),
      cancelLearn: () => this.session.cancelLearn(),
      remove: (row) => edit(row, (list) => withoutMapping(list, row.target)),
      rangeEnd: (row: CcRowView, end: CcRangeEnd, value: number) => {
        const target = row.row;
        if (target) edit(row, (list) => withRangeEnd(list, row.target, end, value, target));
      },
      hold: (on) => {
        this.holding = on;
        if (!on) queueMicrotask(() => this.catchUp());
      },
    };
  }

  /** Escape closes the list, then cancels learn, then closes the panel. */
  private key(e: KeyboardEvent): void {
    if (!this.shown || e.key !== 'Escape') return;
    if (this.picking) {
      this.picking = false;
      this.render();
    } else if (this.session.learning) this.session.cancelLearn();
    else this.hide();
  }

  /** A press outside the panel and its button closes it. */
  private outside(e: PointerEvent): void {
    const target = e.target;
    if (!this.shown || !(target instanceof Node)) return;
    if (this.root.contains(target) || this.anchor?.contains(target)) return;
    this.hide();
  }
}
