/**
 * The compact knob's value bubble (windsor#768 decisions 6 and 7; record
 * `2026-10-12-song-mixer-arrows-and-value-bubbles`, the approved mockup
 * `docs/design/song-mixer-mockup.html`, values option A). The Song tab's
 * mixer pots carry no number beside them; a bubble centred above the dial
 * shows the knob's label and value while it is hovered, pressed, dragged
 * or focused from the keyboard, with a lock's tag in the lock's colour.
 *
 * There is one bubble on the page, hung from the body with fixed
 * positioning, so neither the frozen column, the lanes' scroll box nor the
 * ruler clips it, and it never takes a pointer event. The knob it shows for
 * owns it; another knob taking it ends that, and a timer of a knob that no
 * longer owns it does nothing. While it is up it follows its knob on the
 * console's one frame loop (`watchPlayhead`), and hides when the knob
 * leaves the document or its tab is hidden.
 *
 * When it shows and hides is `knobBubbleModel.ts`'s `knobBubbleStep`; what
 * it reads is the knob's own redraw (`makeKnob`'s `render` calls `update`),
 * so a drag, an arrow key, a lane moving the lock and a Mixer-tab edit
 * redrawing the cell (`refreshMixerCells`) all reach it.
 */
import { el } from './dom';
import type { KnobBubbleContent, KnobBubbleInput, KnobBubbleState } from './knobBubbleModel';
import { BUBBLE_IDLE, knobBubblePlace, knobBubbleStep } from './knobBubbleModel';
import { watchPlayhead } from './stepStrip';

/** The page's one bubble and the knob it shows for. */
interface SharedBubble {
  readonly node: HTMLElement;
  owner: HTMLElement | null;
}

let shared: SharedBubble | null = null;

/** The one bubble, made and hung from the body on first use. */
function sharedBubble(): SharedBubble {
  if (shared?.node.isConnected) return shared;
  const node = el('div', 'knob-bubble');
  node.setAttribute('aria-hidden', 'true');
  node.hidden = true;
  document.body.appendChild(node);
  shared = { node, owner: null };
  return shared;
}

/** Fill the bubble: the label, the value, and the tag in its colour. */
function fill(node: HTMLElement, content: KnobBubbleContent): void {
  const parts: HTMLElement[] = [
    el('small', 'bubble-label', content.label),
    el('span', 'bubble-value', content.value),
  ];
  if (content.tag) {
    const tag = el('span', 'bubble-tag', content.tag.text);
    tag.style.setProperty('--tag-color', content.tag.color);
    parts.push(tag);
  }
  node.replaceChildren(...parts);
}

/** Set the bubble over the knob's dial. */
function place(bubble: HTMLElement, knob: HTMLElement): void {
  const dial = (knob.querySelector('svg') ?? knob).getBoundingClientRect();
  const at = knobBubblePlace({
    centreX: dial.left + dial.width / 2,
    top: dial.top,
    width: bubble.offsetWidth,
    height: bubble.offsetHeight,
    viewportWidth: document.documentElement.clientWidth,
  });
  bubble.style.left = `${at.left}px`;
  bubble.style.top = `${at.top}px`;
  bubble.style.setProperty('--tip-x', `${at.tipX}px`);
}

/** A knob's hold on the bubble: what each redraw tells it. */
export interface KnobBubble {
  /** The knob's content now; redrawn at once while it shows. */
  update(content: KnobBubbleContent): void;
}

/** Whether a release leaves the pointer on `node`: never a lifted finger. */
function releasedInside(node: HTMLElement, e: PointerEvent): boolean {
  if (e.pointerType === 'touch') return false;
  const box = node.getBoundingClientRect();
  return (
    e.clientX >= box.left && e.clientX < box.right && e.clientY >= box.top && e.clientY < box.bottom
  );
}

/** Send `node`'s pointer, focus and reset inputs to `send`. */
function wireInputs(node: HTMLElement, send: (input: KnobBubbleInput) => void): void {
  node.addEventListener('pointerenter', () => send({ kind: 'enter' }));
  node.addEventListener('pointerleave', () => send({ kind: 'leave' }));
  node.addEventListener('pointerdown', () => send({ kind: 'press' }));
  node.addEventListener('pointerup', (e) =>
    send({ kind: 'release', inside: releasedInside(node, e) }),
  );
  node.addEventListener('pointercancel', () => send({ kind: 'release', inside: false }));
  node.addEventListener('focus', () => {
    if (node.matches(':focus-visible')) send({ kind: 'focus' });
  });
  node.addEventListener('blur', () => send({ kind: 'blur' }));
  node.addEventListener('dblclick', () => send({ kind: 'reset' }));
}

/** Whether the bubble is up for `node`. */
const shownFor = (node: HTMLElement): boolean => shared?.owner === node && !shared.node.hidden;

/** Take the bubble down, if `node` still owns it. */
function hideFor(node: HTMLElement): void {
  if (shared?.owner !== node) return;
  shared.node.hidden = true;
  shared.owner = null;
}

/** The knobs whose bubble follows them now, on the frame loop. */
const following = new WeakSet<HTMLElement>();

/**
 * Keep the bubble over `node` each frame while it is up, and take it down
 * once the knob leaves the document or its tab is hidden.
 */
function follow(node: HTMLElement): void {
  if (following.has(node)) return;
  following.add(node);
  watchPlayhead({
    attached: () => {
      if (shownFor(node)) return true;
      following.delete(node);
      return false;
    },
    playheadAt: () => 0,
    mark: () => undefined,
    repaintIf: () => {
      if (!node.isConnected || node.closest('[hidden]')) hideFor(node);
      else if (shared) place(shared.node, node);
    },
  });
}

/** Give `node`, a compact knob, the bubble on hover, press, drag, keyboard focus and reset. */
export function attachKnobBubble(node: HTMLElement): KnobBubble {
  let content: KnobBubbleContent | null = null;
  let state: KnobBubbleState = BUBBLE_IDLE;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const hide = (): void => hideFor(node);
  const show = (): void => {
    if (!content || !node.isConnected) return;
    const bubble = sharedBubble();
    bubble.owner = node;
    fill(bubble.node, content);
    bubble.node.hidden = false;
    place(bubble.node, node);
    follow(node);
  };
  wireInputs(node, (input) => {
    const step = knobBubbleStep(state, input);
    state = step.state;
    const { action } = step;
    if (!action) return;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if ('hide' in action) {
      if (action.hide === 0) hide();
      else hideTimer = setTimeout(hide, action.hide);
      return;
    }
    if (action.show === 0 || shownFor(node)) show();
    else showTimer = setTimeout(show, action.show);
    if (action.hideAfter !== undefined) hideTimer = setTimeout(hide, action.hideAfter);
  });
  return {
    update(next) {
      content = next;
      if (shownFor(node) && shared) {
        fill(shared.node, next);
        place(shared.node, node);
      }
    },
  };
}
