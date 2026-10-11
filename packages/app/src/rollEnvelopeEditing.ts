/**
 * Edit, Draw and Shape on the Roll's shown envelope (windsor#708; epic
 * windsor#699; the approved mockup `docs/design/roll-envelopes-mockup.html`,
 * states 3 to 5): the Song tab's own gestures (`wireLaneEditing`) and Shape
 * tool (`shapeTool`, its popover and `stampedPoints`), mounted on the
 * layer's lane through the roll's host (`rollEnvelopeHost.ts`), not copied.
 *
 * - The lane is the loop's stretch, so a press over the hatched repeats
 *   lands beside it and does nothing; the axis clamps a drag, a stroke and
 *   a Shape range to the loop's end.
 * - A gesture's draft is settled to what an envelope holds
 *   (`rollEnvelopeSettle.ts`) before it is drawn or written, so the preview
 *   is what the release writes: one undo step through the roll editor.
 * - While a press is down the `.readout` above it gives the offset in the
 *   target's units (`rollEnvelopeReadout.ts`): on the point a drag moves,
 *   else on the curve under the pointer. Over the layer, `hover` hears the
 *   value under the pointer, for the column.
 */
import type { RollEnvelope, RollEnvelopePoint } from '@windsor/engine';
import { ROLL_ENVELOPE_ROW, envelopeValueAt } from '@windsor/engine';
import { readoutNode } from './laneEditMarks';
import type { RollViewState } from './rollView';
import { envelopeY } from './rollEnvelopeGeometry';
import { type RollEnvelopeFrame, envelopeAxisTicks, rollEnvelopeHost } from './rollEnvelopeHost';
import type { EnvelopeLayer } from './rollEnvelopeOverlay';
import { dragReading, envelopeOffsetText } from './rollEnvelopeReadout';
import { editablePoints, envelopeUndoLabel, settlePoints } from './rollEnvelopeSettle';
import { ROLL_ENVELOPE_READOUT_PX, ROLL_ENVELOPE_TOOL_UNDO } from './rollEnvelopeTables';
import { wireLaneEditing } from './songAutomationGesture';
import type { ShapeLifeHooks } from './songShapeLife';
import { type ShapeTool, shapeTool } from './songShapeRange';

/** The envelope the tools edit, as the document holds it, and its target's name. */
export interface ShownEnvelope {
  readonly envelope: RollEnvelope;
  readonly name: string;
}

/** What the device hands the tools. */
export interface EnvelopeEditingHost {
  readonly view: RollViewState;
  readonly layer: EnvelopeLayer;
  /** Holds the Shape popover: the device's body, in the pane or in Expand. */
  readonly container: HTMLElement;
  /** The notes pane, whose visible edges keep the popover in. */
  readonly viewport: HTMLElement;
  frame(): RollEnvelopeFrame;
  shown(): ShownEnvelope | null;
  /** Write `points` as the shown envelope's, one undo step named `label`. */
  write(points: readonly RollEnvelopePoint[], label: string): void;
  /** The value under the pointer over the layer, read for the column; null once it leaves. */
  hover(text: string | null): void;
  /** The card's hold on the Shape tool, so the tool closes with it (`rollPopoverLife.ts`). */
  readonly life: ShapeLifeHooks;
}

/** Mount the tools on the layer's lane; the Shape tool is handed back for the device's repaints. */
// eslint-disable-next-line max-lines-per-function -- one lane's gestures, readout and Shape tool share the gesture's start and read as one mounting
export function envelopeEditing(input: EnvelopeEditingHost): ShapeTool {
  const { view, layer } = input;
  const { lane } = layer;
  const host = rollEnvelopeHost(view, () => input.frame());
  const loop = (): number => host.axisTicks();
  const name = (): string => input.shown()?.name ?? '';
  let start: readonly RollEnvelopePoint[] = [];
  let pointerTick = 0;
  let readout: HTMLElement | null = null;

  /** The gesture's start: read at its press, so its draft settles against what it found. */
  const points = (): readonly RollEnvelopePoint[] => {
    start = editablePoints(input.shown()?.envelope.points ?? [], loop());
    return start;
  };
  const settle = (next: readonly RollEnvelopePoint[]): RollEnvelopePoint[] =>
    settlePoints(next, { start, loopTicks: loop(), stroke: view.envelope.tool === 'draw' });

  const hideReadout = (): void => {
    readout?.remove();
    readout = null;
  };
  const showReadout = (draft: readonly RollEnvelopePoint[]): void => {
    const shown = input.shown();
    if (!shown) return;
    const frame = input.frame();
    const at = dragReading(shown.envelope, { start, draft }, pointerTick, loop());
    const node = readoutNode(
      at.tick * frame.pxPerTick,
      envelopeOffsetText(shown.envelope.target, at.value),
    );
    const { liftPx, topPx } = ROLL_ENVELOPE_READOUT_PX;
    node.style.top = `${Math.max(topPx, envelopeY(at.value, frame.heightPx) - liftPx)}px`;
    hideReadout();
    readout = node;
    lane.appendChild(node);
  };

  // Before the gestures' own listeners, so a draft is read out at this event's tick.
  const tickOf = (e: PointerEvent): number =>
    (e.clientX - lane.getBoundingClientRect().left) / input.frame().pxPerTick;
  for (const type of ['pointerdown', 'pointermove'] as const) {
    lane.addEventListener(type, (e) => {
      pointerTick = tickOf(e);
      // The Shape tool's range previews nothing until its popover: read the curve as it is.
      if (view.envelope.tool === 'shape' && (e.buttons & 1) === 1) showReadout(points());
    });
  }
  wireLaneEditing({
    host,
    timeline: lane,
    row: ROLL_ENVELOPE_ROW,
    get name() {
      return name();
    },
    points,
    draw: (next) => {
      const settled = settle(next);
      layer.preview(settled);
      // A cancel (Escape, a blur) draws the start back: the gesture is over.
      if (next === start) hideReadout();
      else showReadout(settled);
    },
    commit: (label, next) => {
      hideReadout();
      input.write(settle(next), envelopeUndoLabel(label, name()));
    },
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    lane.addEventListener(type, hideReadout);
  }
  wireHover(input);

  const shape = shapeTool({
    container: input.container,
    viewport: () => input.viewport,
    tools: host.tools,
    life: input.life,
  });
  shape.attach({
    host,
    key: 'roll-envelope',
    timeline: lane,
    row: ROLL_ENVELOPE_ROW,
    get name() {
      return name();
    },
    points,
    // The preview and Apply both settle here, so Apply writes the dashed curve.
    settle: (next) => settlePoints(next, { start, loopTicks: loop(), stroke: false }),
    commit: (_label, next) => input.write(next, ROLL_ENVELOPE_TOOL_UNDO.shape(name())),
    valueText: (value) => envelopeOffsetText(input.shown()?.envelope.target ?? '', value),
  });
  return shape;
}

/** Over the layer, the shown envelope's value under the pointer, the loop folded over the repeats. */
function wireHover(input: EnvelopeEditingHost): void {
  const { layer } = input;
  layer.root.addEventListener('pointermove', (e) => {
    const shown = input.shown();
    const frame = input.frame();
    const loopTicks = envelopeAxisTicks(frame.loopTicks, frame.regionTicks);
    const tick = (e.clientX - layer.lane.getBoundingClientRect().left) / frame.pxPerTick;
    if (!shown || !(loopTicks > 0) || tick < 0 || tick >= frame.regionTicks) {
      input.hover(null);
      return;
    }
    const value = envelopeValueAt(shown.envelope, tick % loopTicks, loopTicks);
    input.hover(envelopeOffsetText(shown.envelope.target, value));
  });
  layer.root.addEventListener('pointerleave', () => input.hover(null));
}
