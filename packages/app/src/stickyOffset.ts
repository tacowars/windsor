/**
 * How far below the console's sticky header the Mixer's sticky parts sit
 * (windsor#194 decisions 1 and 8). The header (`.chrome`) wraps on a narrow
 * display, so its height is measured, not assumed: one `ResizeObserver` for
 * the life of the page writes it to `--chrome-h` on the document, which the
 * master column's and the bridge's `top` read. It fires only when the
 * header's size changes. A part that measures in pixels rather than reading
 * the variable, like the bridge's `IntersectionObserver`, hears the same
 * change through `onChromeResize`.
 */

const CHROME_SELECTOR = '.chrome';
let following = false;
const listeners = new Set<(heightPx: number) => void>();

/**
 * An observer's `rootMargin` that starts `chromePx` below the viewport's top,
 * so a part hidden under the sticky header counts as out of view. Whole
 * pixels, and never a positive margin.
 */
export function belowChromeRootMargin(chromePx: number): string {
  const px = Number.isFinite(chromePx) ? Math.max(0, Math.round(chromePx)) : 0;
  return `${-px}px 0px 0px 0px`;
}

/** Hear the header's new height each time it changes; returns the unsubscribe. */
export function onChromeResize(listener: (heightPx: number) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The header's height now, in CSS pixels; 0 without one. */
export function chromeHeightPx(): number {
  return document.querySelector(CHROME_SELECTOR)?.getBoundingClientRect().height ?? 0;
}

/** Start writing `--chrome-h`; a second call does nothing. */
export function followChromeHeight(): void {
  if (following) return;
  const chrome = document.querySelector(CHROME_SELECTOR);
  if (!chrome || typeof ResizeObserver === 'undefined') return;
  following = true;
  const write = (): void => {
    const heightPx = chromeHeightPx();
    document.documentElement.style.setProperty('--chrome-h', `${heightPx}px`);
    for (const listener of listeners) listener(heightPx);
  };
  new ResizeObserver(write).observe(chrome);
  write();
}
