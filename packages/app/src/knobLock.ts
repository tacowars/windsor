/**
 * A locked knob's look and its follow (windsor#351; record
 * `2026-10-01-song-automation-lanes` decision 6, the lit ring tacowars chose
 * in `docs/design/automation-lanes-mockup.html`): while a lane holds the
 * knob, its arc, pin and cap ring take the lane's colour and an AUTO tag
 * sits under its value (`console.css`'s "locked knob" section, keyed on
 * `.locked` and `--lock-color`). A knob a macro mapping holds reads the
 * macro's name in the tag instead (windsor#561), and takes `.mapped`. Which
 * lane or mapping holds it is `knobAutomation.ts`.
 *
 * The knob follows its lane on the console's one frame loop
 * (`watchPlayhead`): each frame it is on screen it asks its lane again and
 * redraws only when the lock or the lane's value moved, so a play, a seek, a
 * lane switched off or deleted all show without a rebuild.
 *
 * An insert's power button locks the same way under a lane on its on/off
 * switch (windsor#631, record `2026-10-06-insert-switch-lanes` decision 9):
 * `paintLock` lights it, and it shows the lane's level (`switchShowsOn`).
 *
 * A knob a Roll clip envelope moves (windsor#725) is not locked: it takes
 * `.env`, its tag reads ENV in the envelope's colour (`console.css`'s "env
 * ring" section), and `knob.ts` draws its second ring at the playing value.
 * Under a lane's lock too, the tag is the lock's. The same frame loop
 * follows the ring.
 *
 * A knob a MIDI CC mapping drives (windsor#785, record
 * `2026-10-13-midi-cc-mapping` decision 3) takes `.cc` while no lock holds
 * it, and its tag reads `CC <n>` whether or not an envelope plays: the tag
 * is AUTO (or the macro's name) under a lock, else `CC <n>` while a mapping
 * exists, else ENV while an envelope plays (`knobTagText`). The ring is the
 * env ring's, run to the CC's value with any envelope over it; while pickup
 * is armed the knob takes `.cc-waiting`, and while learn listens for it
 * `.cc-learn` with a hint under it (`console.css`'s "the CC knob" section).
 */
import { switchValue } from '@windsor/engine';
import type { KnobAutomation } from './knobAutomation';
import { sameKnobAutomation } from './knobAutomation';
import type { KnobCc } from './knobCc';
import { emptyKnobCc, knobCcMoved } from './knobCc';
import type { KnobEnvelope } from './knobEnvelope';
import { watchPlayhead, type FrameSource } from './stepStrip';

/** The AUTO tag's text. */
export const AUTO_TAG_TEXT = 'AUTO';

/** The tag a knob a clip envelope moves reads, while no lock holds it (windsor#725). */
export const ENV_TAG_TEXT = 'ENV';

/** The tag a lock reads: its macro's name, else AUTO. */
export const lockTagText = (lock: KnobAutomation | null): string => lock?.macro ?? AUTO_TAG_TEXT;

/** The tag a knob a CC mapping drives reads (windsor#785). */
export const ccTagText = (cc: number): string => `CC ${cc}`;

/**
 * The knob's tag (record `2026-10-13-midi-cc-mapping` decision 3): the lock's
 * while one holds the knob, else `CC <n>` while a mapping drives it, else
 * ENV while an envelope moves it. With none of them the tag is hidden, and
 * reads AUTO for the next lock.
 */
export function knobTagText(
  lock: KnobAutomation | null,
  cc: number | null,
  enveloped: boolean,
): string {
  if (lock) return lockTagText(lock);
  if (cc !== null) return ccTagText(cc);
  return enveloped ? ENV_TAG_TEXT : AUTO_TAG_TEXT;
}

/** The hint under a knob learn listens for, and the key that cancels it (the mockup's `.learn-hint`). */
export const LEARN_HINT_TEXT = 'Move a knob on your controller…';
export const LEARN_HINT_KEY = 'Esc cancels';

/** Light or clear the lock on `node`: the classes the stylesheet keys on, the lane's colour and the tag. */
export function paintLock(node: HTMLElement, lock: KnobAutomation | null): void {
  node.classList.toggle('locked', lock !== null);
  node.classList.toggle('mapped', lock?.macro !== undefined);
  const tag = node.querySelector('.knob-auto');
  if (tag) tag.textContent = lockTagText(lock);
  if (lock) node.style.setProperty('--lock-color', lock.color);
  else node.style.removeProperty('--lock-color');
}

/**
 * Light or clear the ring's look on `node`: `.env` while a ring shows (an
 * envelope moves the knob, windsor#725, or a CC's value plays on it,
 * windsor#785), `.cc` while a mapping drives a knob no lock holds, with
 * `.cc-waiting` while its pickup is armed, and `.cc-learn` with its hint
 * while learn listens for it. The tag reads `knobTagText`.
 */
export function paintEnvelope(
  node: HTMLElement,
  ring: KnobEnvelope | null,
  lock: KnobAutomation | null,
  cc: KnobCc | null = null,
): void {
  const mapped = lock === null && cc?.cc !== null && cc?.cc !== undefined ? cc.cc : null;
  node.classList.toggle('env', ring !== null);
  node.classList.toggle('cc', mapped !== null);
  node.classList.toggle('cc-waiting', mapped !== null && cc?.waiting === true);
  paintLearning(node, cc?.learning === true);
  const tag = node.querySelector('.knob-auto');
  if (tag) tag.textContent = knobTagText(lock, mapped, ring !== null);
}

/** Light the knob learn listens for, with the hint under it; clear both once it stops. */
function paintLearning(node: HTMLElement, learning: boolean): void {
  if (node.classList.contains('cc-learn') === learning) return;
  node.classList.toggle('cc-learn', learning);
  if (!learning) {
    node.querySelector('.knob-cc-hint')?.remove();
    return;
  }
  const hint = document.createElement('span');
  hint.className = 'knob-cc-hint';
  hint.textContent = LEARN_HINT_TEXT;
  const key = document.createElement('span');
  key.className = 'k';
  key.textContent = LEARN_HINT_KEY;
  hint.append(key);
  node.append(hint);
}

/** Whether an insert's power button shows on: the lane's level while one holds it, else `enabled`. */
export const switchShowsOn = (enabled: boolean, lock: KnobAutomation | null): boolean =>
  lock ? switchValue(lock.value) === 1 : enabled;

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
  followKnob(node, { automation }, render, frame);
}

/** What a knob follows: the lock on it, the clip envelope moving it, and its CC mapping. */
export interface KnobReads {
  readonly automation?: (() => KnobAutomation | null) | undefined;
  readonly envelope?: (() => KnobEnvelope | null) | undefined;
  readonly cc?: (() => KnobCc | null) | undefined;
}

/**
 * Whether an envelope reading moved from the last one, `last` then taking it
 * (copied: the reading may be the knob's one reused answer).
 */
export function envelopeMoved(
  last: KnobEnvelope & { shown: boolean },
  now: KnobEnvelope | null,
): boolean {
  const shown = now !== null;
  if (shown === last.shown && (!now || (now.base === last.base && now.playing === last.playing))) {
    return false;
  }
  last.shown = shown;
  last.base = now?.base ?? 0;
  last.playing = now?.playing ?? 0;
  return true;
}

/**
 * `followAutomation` over all of a knob's reads, on one watch: a frame
 * whose lock, envelope or CC answers differently redraws it once.
 */
export function followKnob(
  node: HTMLElement,
  reads: KnobReads,
  render: () => void,
  frame?: FrameSource,
): void {
  const { automation, envelope, cc } = reads;
  let last = automation?.() ?? null;
  const lastEnvelope = { shown: false, base: 0, playing: 0 };
  if (envelope) envelopeMoved(lastEnvelope, envelope());
  const lastCc = { ...emptyKnobCc(), shown: false };
  if (cc) knobCcMoved(lastCc, cc());
  watchPlayhead({
    attached: () => node.isConnected,
    shown: () => node.closest('[hidden]') === null,
    playheadAt: () => 0,
    mark: () => undefined,
    repaintIf: () => {
      const now = automation?.() ?? null;
      const lockMoved = !sameKnobAutomation(now, last);
      last = now;
      const ringMoved = envelope ? envelopeMoved(lastEnvelope, envelope()) : false;
      const ccMoved = cc ? knobCcMoved(lastCc, cc()) : false;
      if (lockMoved || ringMoved || ccMoved) render();
    },
    ...(frame ? { frame } : {}),
  });
}
