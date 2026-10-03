/**
 * The mixer lights' poller (windsor#159): a green activity light and a red
 * clip light in each row of the Mixer tab's Groups section (windsor#287),
 * keyed on group ids over each group bus's strip meter
 * (`songMixerLightsSource.ts`'s `meterLights`). The Song tab's part rows
 * lost theirs to the part strip's chips (windsor#554), which paint with
 * `paintLights` here over the part meter bank (`partStripLights.ts`).
 *
 * One poller owns a view's lights, not one per row (the issue's amendment
 * after PR #170): a view may draw its rows again on any render, so the rows
 * only hand their light elements to `lightsFor`, and the poller asks its
 * source for the rows attached, on screen and with the tab shown, keyed by
 * id, never by row.
 *
 * It runs on the shared frame driver (`watchPlayhead`), touches a light only
 * when its step or its latch changes, and releases its source on hide once,
 * so a hidden tab never switches off a meter another tab is using.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import { lightRamp } from './songMixerLightsModel';
import type { LightMeters } from './songMixerLightsSource';
import { meterLights } from './songMixerLightsSource';
import { CLIP_TITLES } from './songMixerLightsTables';
import { watchPlayhead } from './stepStrip';

export type { LightMeters } from './songMixerLightsSource';

/** What a row asks its view's poller for. */
export interface MixerLights {
  /** The row's two lights, registered with the poller by key; the row places the element. */
  lightsFor(key: number, name: string): HTMLElement;
}

/** A pair of lights as drawn: the Groups section's rows' and the part strip's chips'. */
export interface DrawnLights {
  readonly clip: HTMLElement;
  readonly activity: HTMLElement;
  /** What is drawn, so a frame writes the DOM only when it changes; -1 before the first paint. */
  drawnStep: number;
  drawnClip: boolean | null;
}

const RAMP = lightRamp();

/** Draw `step` and the latch on a pair of lights, touching only what changed. */
export function paintLights(lights: DrawnLights, step: number, clipped: boolean): void {
  if (lights.drawnStep !== step) {
    lights.drawnStep = step;
    lights.activity.style.backgroundColor = RAMP[step]!;
    lights.activity.classList.toggle('on', step > 0);
  }
  if (lights.drawnClip !== clipped) {
    lights.drawnClip = clipped;
    lights.clip.classList.toggle('lit', clipped);
    lights.clip.title = clipped ? CLIP_TITLES.lit : CLIP_TITLES.dark;
    if (lights.clip instanceof HTMLButtonElement) {
      lights.clip.setAttribute('aria-pressed', String(clipped));
    }
  }
}

interface LightRow extends DrawnLights {
  readonly key: number;
  readonly root: HTMLElement;
  /** The row is inside the scroll's view, as the `IntersectionObserver` last said. */
  onScreen: boolean;
}

/** The poller over a view's rows, reading `meters`: the Groups section's group buses' strip meters by id. */
// eslint-disable-next-line max-lines-per-function -- one owner's closure: its rows, the frame poll and the release rules share the same state
export function songMixerLights(ctx: AppCtx, meters: LightMeters): MixerLights {
  const source = meterLights(ctx, meters);
  const rows = new Set<LightRow>();
  const byElement = new WeakMap<Element, LightRow>();
  const wanted = new Set<number>();
  let running = false;
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const row = byElement.get(entry.target);
            if (row) row.onScreen = entry.isIntersecting;
          }
        });

  /** Drop the rows a re-render took away; forget a key none of the rows shows. */
  const prune = (): void => {
    let removed = false;
    for (const row of rows) {
      if (row.root.isConnected) continue;
      observer?.unobserve(row.root);
      rows.delete(row);
      removed = true;
    }
    if (!removed) return;
    const shown = new Set([...rows].map((row) => row.key));
    source.retain((key) => shown.has(key));
  };

  const start = (): void => {
    if (running) return;
    running = true;
    const first = (): LightRow | undefined => rows.values().next().value;
    watchPlayhead({
      attached: () => {
        prune();
        if (rows.size > 0) return true;
        source.release();
        running = false;
        return false;
      },
      // Released the first hidden frame only: the source has nothing on after it.
      shown: () => {
        if (first()?.root.closest('[hidden]') === null) return true;
        source.release();
        return false;
      },
      playheadAt: () => {
        wanted.clear();
        for (const row of rows) if (row.onScreen) wanted.add(row.key);
        return source.poll(wanted);
      },
      mark: () => {
        for (const row of rows) paintLights(row, source.step(row.key), source.lit(row.key));
      },
    });
  };

  const clear = (key: number): void => {
    source.clear(key);
    for (const row of rows) if (row.key === key) paintLights(row, row.drawnStep, false);
  };

  return {
    lightsFor(key, name) {
      const root = el('div', 'mix-lights');
      const clip = el('button', 'mix-clip') as HTMLButtonElement;
      clip.type = 'button';
      clip.setAttribute('aria-label', `${name} clip`);
      clip.onclick = () => clear(key);
      const activity = el('span', 'mix-activity');
      activity.setAttribute('aria-hidden', 'true');
      root.append(clip, activity);
      const row: LightRow = {
        key,
        root,
        clip,
        activity,
        onScreen: observer === null,
        drawnStep: -1,
        drawnClip: null,
      };
      paintLights(row, source.step(key), source.lit(key));
      rows.add(row);
      byElement.set(root, row);
      observer?.observe(root);
      start();
      return root;
    },
  };
}
