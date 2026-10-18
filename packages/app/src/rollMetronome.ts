/**
 * The metronome button on the Roll device (windsor#906 decision 5): one
 * square button after Rec holding a metronome glyph, lit in the console's
 * accent while on, with no label and no menu. Every Roll device on screen
 * shows the one switch, which the host holds (`EngineHost.metronomeOn`) and
 * `rollMetronomePrefs.ts` keeps across reloads; a press flips it, stores it
 * and repaints every device's button. It works before audio is on: the host
 * keeps the switch and hands the engine the click once the live system
 * exists, and the engine clicks while the transport runs.
 */
import type { AppCtx } from './context';
import { el, html } from './dom';
import { writeMetronomeOn } from './rollMetronomePrefs';
import { ROLL_METRONOME } from './rollTables';

/** The class every device's button carries, so a press repaints them all. */
const BUTTON_CLASS = 'roll-metronome';

function paint(button: HTMLElement, on: boolean): void {
  button.setAttribute('aria-pressed', String(on));
}

/** The metronome's item for the Roll controls, under Rec. */
export function rollMetronome(ctx: AppCtx): HTMLElement {
  const button = html('button', BUTTON_CLASS, ROLL_METRONOME.glyph) as HTMLButtonElement;
  button.type = 'button';
  button.title = ROLL_METRONOME.title;
  button.setAttribute('aria-label', ROLL_METRONOME.title);
  paint(button, ctx.host.metronomeOn);
  button.onclick = () => {
    const on = !ctx.host.metronomeOn;
    ctx.host.setMetronome(on);
    writeMetronomeOn(on);
    for (const each of document.querySelectorAll<HTMLElement>(`.${BUTTON_CLASS}`)) paint(each, on);
  };
  const item = el('div', 'roll-item metronome-item');
  item.appendChild(button);
  return item;
}
