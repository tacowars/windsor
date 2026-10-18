/**
 * Focus handed back from a dropdown picked with the mouse, so the audition
 * keyboard's QWERTY keys play again at once (split out of `keyboard.ts`,
 * windsor#919).
 *
 * A dropdown picked with the mouse keeps focus, and the note keys are
 * ignored inside a select (a letter there would change its value), so every
 * pick — wave, filter, preset category — cost a click away before auditioning.
 * A mouse pick now hands focus back; a keyboard user arrowing through the
 * options keeps it. Listboxes (`size` > 1) are left to their owners.
 */
export function releaseMousePickedDropdowns(): void {
  let pickedByMouse = false;
  addEventListener(
    'pointerdown',
    (e) => {
      pickedByMouse = e.target instanceof HTMLSelectElement;
    },
    true,
  );
  addEventListener(
    'keydown',
    () => {
      pickedByMouse = false;
    },
    true,
  );
  addEventListener(
    'change',
    (e) => {
      const t = e.target;
      if (pickedByMouse && t instanceof HTMLSelectElement && !t.multiple && t.size <= 1) t.blur();
    },
    true,
  );
}
