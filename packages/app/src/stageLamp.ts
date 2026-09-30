/**
 * The stage lamp (windsor#194 decisions 4 and 5): a button in the master
 * column's header and in the bridge, amber while the output stage has acted
 * in the last second, red while its watch is latched, named by
 * `stageLampView`. Clicking it runs the watch's `resetLatch`.
 *
 * Its lit state paints from the meter loop, so it costs nothing while
 * nobody sees it; a mode edit or a cleared latch repaints it at once
 * through the link. It writes the DOM only when its look changes.
 */
import { el } from './dom';
import type { MeterPart } from './meterLoop';
import type { OutputStageLink } from './outputStageLink';
import { type StageLampView, stageLampView } from './stageLampModel';

/** One string per look, so a steady lamp writes nothing. */
const lookKey = (view: StageLampView): string =>
  `${view.lit ? 1 : 0}${view.latched ? 1 : 0}${view.label}`;

export function createStageLamp(link: OutputStageLink): MeterPart<Element> {
  const root = el('button', 'stage-lamp') as HTMLButtonElement;
  root.type = 'button';
  const dot = el('i', 'stage-lamp-dot');
  dot.setAttribute('aria-hidden', 'true');
  const label = el('span', 'stage-lamp-label');
  root.append(dot, label);
  let shown = '';

  const paint = (nowMs: number): void => {
    const view = stageLampView(link.settings().mode, link.watch(), nowMs);
    const key = lookKey(view);
    if (key === shown) return;
    shown = key;
    root.classList.toggle('is-lit', view.lit);
    root.classList.toggle('is-latched', view.latched);
    label.textContent = view.label;
    root.title = view.title;
    root.setAttribute(
      'aria-label',
      `Output stage: ${view.label}${view.latched ? ', latched' : ''}`,
    );
  };
  root.addEventListener('click', () => {
    link.watch()?.resetLatch();
    link.changed();
  });
  link.onChange(() => paint(performance.now()));
  paint(performance.now());
  return { root, paint, reset: () => undefined };
}
