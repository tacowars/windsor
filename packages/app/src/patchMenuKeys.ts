/**
 * Arrow-key movement through a short list of controls (windsor#537
 * decision 1): the ⋯ patch menu, and the patch browser's facets and info
 * pane. ArrowDown and ArrowUp move to the next and previous enabled item and
 * wrap; Home and End go to the first and last; a disabled item is skipped.
 * Tab stays the tab switch (`tabShell.ts`), so these keys are how a keyboard
 * user walks such a list. `menuTarget` is the rule, pure; `moveMenuFocus`
 * applies it to the elements.
 */

/** The keys `menuTarget` answers; any other key leaves focus where it is. */
const MENU_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * The index focus moves to from `from` on `key`, over items whose
 * enabled-ness is `enabled`; null for another key or when no item is
 * enabled. A `from` outside the list (nothing focused yet) starts before the
 * first item going down and after the last going up.
 */
export function menuTarget(enabled: readonly boolean[], from: number, key: string): number | null {
  if (!MENU_KEYS.has(key)) return null;
  const count = enabled.length;
  const down = key === 'ArrowDown' || key === 'Home';
  let at: number;
  if (key === 'Home') at = -1;
  else if (key === 'End') at = count;
  else if (from >= 0 && from < count) at = from;
  else at = down ? -1 : count;
  for (let step = 1; step <= count; step++) {
    const index = (((down ? at + step : at - step) % count) + count) % count;
    if (enabled[index]) return index;
  }
  return null;
}

/**
 * Move focus within `items` for `event`'s key; true when the key was one of
 * the list's (the caller's event is then handled and prevented here).
 */
export function moveMenuFocus(items: readonly HTMLButtonElement[], event: KeyboardEvent): boolean {
  const from = items.findIndex((item) => item === document.activeElement);
  const to = menuTarget(
    items.map((item) => !item.disabled),
    from,
    event.key,
  );
  if (to === null) return false;
  event.preventDefault();
  event.stopPropagation();
  items[to]?.focus();
  return true;
}
