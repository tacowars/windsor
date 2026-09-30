/**
 * How far below the console's sticky header the Mixer's sticky parts sit
 * (windsor#194 decisions 1 and 8). The header (`.chrome`) wraps on a narrow
 * display, so its height is measured, not assumed: one `ResizeObserver` for
 * the life of the page writes it to `--chrome-h` on the document, which the
 * master column's and the bridge's `top` read. It fires only when the
 * header's size changes.
 */

const CHROME_SELECTOR = '.chrome';
let following = false;

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
  const write = (): void =>
    document.documentElement.style.setProperty('--chrome-h', `${chromeHeightPx()}px`);
  new ResizeObserver(write).observe(chrome);
  write();
}
