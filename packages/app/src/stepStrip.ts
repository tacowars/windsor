/**
 * The step strip every sequencer card draws on (#619 decision 1): the cells
 * and columns, the playhead lighting, the one `requestAnimationFrame` loop
 * that follows the transport, and the two document helpers a card needs to
 * read its own spec and write a step list back.
 *
 * The three cards (#603 grid, #607 chord, #610 Euclidean) each carried a copy
 * of all of this. One copy lives here, so a fourth kind is a model, a card
 * that fills in its columns, and a registry entry (`sequencerCards.ts`).
 *
 * Nothing here decides *where* the playhead is: that is the engine's, through
 * `host.stepAt` (decision 2). `playheadAt` is the console's only reading of
 * the audible tick.
 */
import { partAt, type SequencerKind, type SequencerSpec } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { changePattern, patternOf } from './partEdits';
import { regionAt } from './regionModel';

/**
 * The spec the part on `slot` plays in region `region` (windsor#75) — or,
 * with no region named, its sequencer — when it is of `kind`, else null.
 */
export function specOf<K extends SequencerKind>(
  ctx: AppCtx,
  slot: number,
  kind: K,
  region?: number,
): Extract<SequencerSpec, { kind: K }> | null {
  const sequencer = patternOf(ctx.model.doc, slot, region);
  // The union is discriminated by `kind`; TypeScript cannot narrow through a
  // generic comparison, so the check above is the narrowing and this is its cast.
  return sequencer?.kind === kind ? (sequencer as Extract<SequencerSpec, { kind: K }>) : null;
}

/** What the playhead loop needs of a card: where it draws, and where it is. */
export interface PlayheadStrip {
  /** The element holding one child per step. */
  root: HTMLElement;
  /** The column or cell the playhead sits on, or -1; reapplied after every repaint. */
  playing: number;
}

/** A column strip and what every cell needs to write a step and redraw. */
export interface Strip<S> extends PlayheadStrip {
  ctx: AppCtx;
  slot: number;
  /** The region whose pattern the strip edits (windsor#75); absent, the part's sequencer. */
  region?: number | undefined;
  /** This card's spec, or null when the part is gone or re-kinded. */
  spec(): S | null;
  repaint(): void;
}

/** Write an edited step list into the strip's region (`changePattern`), and redraw if it took. */
export function commitSteps<S, T>(strip: Strip<S>, edit: (spec: S) => T): void {
  const spec = strip.spec();
  if (!spec) return;
  if (changePattern(strip.ctx, strip.slot, strip.region, { steps: edit(spec) })) strip.repaint();
}

/** One `.gcell` button; `blank` keeps a column's height where a rest or tie has no field. */
export function stripCell(label: string, className = ''): HTMLButtonElement {
  const node = el('button', `gcell ${className}`.trim(), label) as HTMLButtonElement;
  node.type = 'button';
  return node;
}

/** One `.grid-col`: the step number, then the cells; `active` false greys a step past the loop. */
export function stripColumn(
  index: number,
  active: boolean,
  cells: readonly HTMLElement[],
): HTMLElement {
  const col = el('div', active ? 'grid-col' : 'grid-col off');
  col.appendChild(el('div', 'grid-idx', String(index + 1)));
  for (const node of cells) col.appendChild(node);
  return col;
}

/**
 * What lighting the playhead reads of a strip — its children's class lists.
 * Structural on purpose: a real element satisfies it, and so does a test's
 * stand-in, so the loop and its lighting are driven without a DOM.
 */
export interface LitStrip {
  readonly children: ArrayLike<{
    readonly classList: { toggle(token: string, on: boolean): void };
  }>;
}

/** Light the playhead's child of a strip, or none for -1. */
export function markPlaying(strip: LitStrip, playing: number): void {
  const { children } = strip;
  for (let i = 0; i < children.length; i++) children[i]?.classList.toggle('playing', i === playing);
}

/** Remember the step the card is on and light it: what a card hands the loop as `mark`. */
export const markStep =
  (strip: PlayheadStrip) =>
  (step: number): void => {
    strip.playing = step;
    markPlaying(strip.root, step);
  };

/** Redraw every column from the document, keeping the horizontal scroll where it was. */
export function paintStrip<S>(strip: Strip<S>, columns: (spec: S) => readonly HTMLElement[]): void {
  const spec = strip.spec();
  const scrollLeft = strip.root.scrollLeft;
  strip.root.innerHTML = '';
  if (!spec) return;
  for (const col of columns(spec)) strip.root.appendChild(col);
  strip.root.scrollLeft = scrollLeft;
  markPlaying(strip.root, strip.playing);
}

/** Where the loop gets its frames; a test drives it with its own. */
export type FrameSource = (run: () => void) => void;

/**
 * One frame request shared by every watch (#709 decision 5): the callbacks
 * queued since the last frame run together on the next one, so the Song
 * view's ruler line and the card in its pane — and every card on any tab —
 * cost one `requestAnimationFrame` between them, not one each. A callback
 * that re-queues itself while the batch runs lands in the next frame.
 */
export function createFrameDriver(frame: FrameSource): FrameSource {
  let pending: Array<() => void> = [];
  let queued = false;
  const flush = (): void => {
    queued = false;
    const due = pending;
    pending = [];
    for (const run of due) run();
  };
  return (run) => {
    pending.push(run);
    if (queued) return;
    queued = true;
    frame(flush);
  };
}

/** The console's one animation-frame request; a watch without a `frame` of its own joins it. */
const SHARED_FRAMES: FrameSource = createFrameDriver(
  (run: () => void): void => void requestAnimationFrame(run),
);

/** What one card asks the playhead loop to do each frame. */
export interface PlayheadWatch {
  /** True while the card is in the document; the first frame it is not, the loop ends. */
  attached(): boolean;
  /** The step the transport is on, or -1 — `playheadAt` for every card that sounds. */
  playheadAt(): number;
  /** Light a step. Called only when it changed. */
  mark(step: number): void;
  /** Checked before the playhead: a repaint the document or the player asks for. */
  repaintIf?(): void;
  /**
   * True while the card's panel is on screen; defaults to always shown. A frame
   * it is false costs the frame and nothing else — no repaint, no playhead.
   */
  shown?(): boolean;
  /** Defaults to the console's shared frame driver over `requestAnimationFrame`. */
  frame?: FrameSource;
}

/**
 * The console's one playhead loop (#619 decision 1). Per frame while the card
 * is on screen: whatever the card re-reads (its key signature, the figure the
 * player holds), then the playhead, marked only when it moved. The frame after
 * the card leaves the document nothing is queued, so a card replaced by a
 * re-render takes its loop with it.
 *
 * While the card's panel is hidden the loop idles (#632 decision 1): the frame
 * is still queued, so showing the tab again needs no lifecycle event, but the
 * frame does no work. The step lit when the tab went away stays lit, and the
 * first shown frame moves it if the transport moved meanwhile.
 *
 * Every watch without a frame source of its own shares one request
 * (`createFrameDriver`, #709 decision 5): the view has one loop however many
 * strips and lines it lights.
 */
export function watchPlayhead(watch: PlayheadWatch): void {
  const frame = watch.frame ?? SHARED_FRAMES;
  let playing = -1;
  const tick = (): void => {
    if (!watch.attached()) return;
    frame(tick);
    if (watch.shown && !watch.shown()) return;
    watch.repaintIf?.();
    const current = watch.playheadAt();
    if (current === playing) return;
    playing = current;
    watch.mark(current);
  };
  frame(tick);
}

/**
 * The transport's audible tick, or 0 before audio is enabled — what the chord
 * card's Hit tile auditions at (#705) and the strip's position reads (#708).
 * `ctx.transport.position()` is the one scheduler reading (`host.ts`).
 */
export function audibleTick(ctx: AppCtx): number {
  return ctx.transport.position();
}

/**
 * The step the part on `slot` is sounding, or -1 while nothing runs: the
 * audible tick put through the engine's own `stepAt` (#619 decision 2).
 * A region card names its `region`: `stepAt` resolves the generator of the
 * region under the audible tick, so the ring lights only while the transport
 * is inside that region, and stays dark while another one plays (windsor#75).
 */
export function playheadAt(ctx: AppCtx, slot: number, region?: number): number {
  if (!ctx.transport.running) return -1;
  const tick = audibleTick(ctx);
  if (region !== undefined) {
    const part = partAt(ctx.model.doc, slot);
    if (part === undefined || regionAt(part.regions, tick) !== region) return -1;
  }
  return ctx.host.stepAt(slot, tick);
}
