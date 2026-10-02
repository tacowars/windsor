/**
 * A locked knob's look and its follow (windsor#351; record
 * `2026-10-01-song-automation-lanes` decision 6, the lit ring tacowars chose
 * in `docs/design/automation-lanes-mockup.html`): while a lane holds the
 * knob, its arc, pin and cap ring take the lane's colour and an AUTO tag
 * sits under its value (`console.css`'s "locked knob" section, keyed on
 * `.locked` and `--lock-color`). Which lane holds it is `knobAutomation.ts`.
 *
 * The knob follows its lane on the console's one frame loop
 * (`watchPlayhead`): each frame it is on screen it asks its lane again and
 * redraws only when the lock or the lane's value moved, so a play, a seek, a
 * lane switched off or deleted all show without a rebuild.
 */
import type { KnobAutomation } from './knobAutomation';
import { sameKnobAutomation } from './knobAutomation';
import { watchPlayhead, type FrameSource } from './stepStrip';

/** The AUTO tag's text. */
export const AUTO_TAG_TEXT = 'AUTO';

/** Light or clear the lock on `node`: the class the stylesheet keys on, and the lane's colour. */
export function paintLock(node: HTMLElement, lock: KnobAutomation | null): void {
  node.classList.toggle('locked', lock !== null);
  if (lock) node.style.setProperty('--lock-color', lock.color);
  else node.style.removeProperty('--lock-color');
}

/**
 * Redraw `node` through `render` whenever `automation` answers differently,
 * until the knob leaves the document. A frame the knob's tab is hidden does
 * nothing (#632's rule: layout-free, `closest('[hidden]')`).
 */
export function followAutomation(
  node: HTMLElement,
  automation: () => KnobAutomation | null,
  render: () => void,
  frame?: FrameSource,
): void {
  let last = automation();
  watchPlayhead({
    attached: () => node.isConnected,
    shown: () => node.closest('[hidden]') === null,
    playheadAt: () => 0,
    mark: () => undefined,
    repaintIf: () => {
      const now = automation();
      if (sameKnobAutomation(now, last)) return;
      last = now;
      render();
    },
    ...(frame ? { frame } : {}),
  });
}
