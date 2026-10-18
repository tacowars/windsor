/**
 * Touch never zooms the page (record 2026-10-18-the-page-never-zooms). The
 * viewport meta and `html { touch-action: pan-x pan-y }` cover Chromium, but
 * iOS Safari ignores `user-scalable=no` and does not fully honour
 * `touch-action` on the root, so its own gesture events and any `touchmove`
 * carrying more than one touch are cancelled here. Pointer events and
 * single-finger moves are left alone, so knob drags, lanes, long-press and
 * keyboard chords behave as before.
 */

const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

const cancel = (event: Event): void => event.preventDefault();

const cancelMultiTouch = (event: TouchEvent): void => {
  if (event.touches.length > 1) event.preventDefault();
};

/** Installs the lock on `doc`; `main.ts` calls it once at boot. */
export function installPageZoomLock(doc: Document): void {
  for (const type of GESTURE_EVENTS) doc.addEventListener(type, cancel, { passive: false });
  doc.addEventListener('touchmove', cancelMultiTouch, { passive: false });
}
