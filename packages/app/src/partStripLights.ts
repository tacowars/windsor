/**
 * The part strip's chip lights (windsor#528): the Song mixer's two lights
 * drawn small at each chip's top right, the red clip latch over the green
 * activity light, on every tab (the Song lanes mockup's Meters state). They
 * read the part lights (`partLights.ts`), so the chips and the Song mixer
 * show one set of meters, the part meter bank, and one latch per part.
 *
 * A click on a lit red light clears it, in the mixer too, and does not pick
 * the part; a click on a dark one is the chip's. The chip is a button, so
 * the light is a plain element, out of the accessibility tree: the Song
 * mixer's clip button is the keyboard's way to clear it.
 *
 * The loop is the console's one frame request (`watchPlayhead`), which also
 * keeps the bank switched on while audio is on, and a light is touched only
 * when its step or its latch changed.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import { partLights } from './partLights';
import type { DrawnLights } from './songMixerLights';
import { paintLights } from './songMixerLights';
import { watchPlayhead } from './stepStrip';

/** The chips' lights as the strip draws them, by slot. */
export interface StripLights {
  /** A fresh pair of lights for each of `slots`, in place of the last draw's. */
  draw(slots: readonly number[]): ReadonlyMap<number, HTMLElement>;
}

interface ChipLights extends DrawnLights {
  readonly root: HTMLElement;
}

function chipLights(ctx: AppCtx, slot: number): ChipLights {
  const lights = partLights(ctx);
  const root = el('span', 'cl');
  root.setAttribute('aria-hidden', 'true');
  const clip = el('i', 'clip');
  const activity = el('i', 'act');
  root.append(clip, activity);
  const chip: ChipLights = { root, clip, activity, drawnStep: -1, drawnClip: null };
  clip.addEventListener('click', (e) => {
    if (!lights.lit(slot)) return;
    e.stopPropagation();
    lights.clear(slot);
    paintLights(chip, chip.drawnStep, false);
  });
  paintLights(chip, lights.step(slot), lights.lit(slot));
  return chip;
}

/** Start the chips' poll for as long as `root` is in the document. */
export function watchStripLights(ctx: AppCtx, root: HTMLElement): StripLights {
  const lights = partLights(ctx);
  let chips = new Map<number, ChipLights>();
  watchPlayhead({
    attached: () => root.isConnected,
    playheadAt: () => lights.sync(),
    mark: () => {
      for (const [slot, chip] of chips) paintLights(chip, lights.step(slot), lights.lit(slot));
    },
  });
  return {
    draw(slots) {
      chips = new Map(slots.map((slot) => [slot, chipLights(ctx, slot)]));
      return new Map([...chips].map(([slot, chip]) => [slot, chip.root]));
    },
  };
}
