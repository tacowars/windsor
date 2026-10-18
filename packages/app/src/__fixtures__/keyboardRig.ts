/**
 * The audition keyboard's test rig (windsor#863): fake keys that light and
 * report a box laid out as the touch row's CSS places them, a fake part that
 * logs what the keyboard asks of it, and pointers at a point on a key.
 */
import type { AudioPart } from '@windsor/engine';
import type { PointerInput } from '../keyboard';
import { afterWhite, isBlackKey } from '../keyboardLayout';
import type { Box } from '../keyboardLayout';

/** An on-screen key: its `down` light, which a press sets and a lift clears, and its box. */
export interface FakeKey {
  readonly classes: Set<string>;
  readonly el: HTMLElement;
}
export const fakeKeys: FakeKey[] = [];
export function fakeKey(box: Box): FakeKey {
  const classes = new Set<string>();
  const el = {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    getBoundingClientRect: () => box,
  } as unknown as HTMLElement;
  const key = { classes, el };
  fakeKeys.push(key);
  return key;
}
export const litKeys = (): number => fakeKeys.filter((k) => k.classes.has('down')).length;

/** A row's white key width and height, and the black keys' share of them, as the touch row has. */
export const WHITE = 40;
export const HEIGHT = 100;
export const BLACK_W = 0.6;
export const BLACK_H = 0.62;
/** The row's top edge on the page, so a box is never read at the origin by accident. */
export const TOP = 500;

/** `count` keys laid out as the touch row's CSS places them, `left` px from the page's edge. */
export function row(count: number, left = 0): FakeKey[] {
  return Array.from({ length: count }, (_, offset) => {
    if (!isBlackKey(offset)) {
      const x = left + (afterWhite(offset) + 1) * WHITE;
      return fakeKey({ left: x, top: TOP, right: x + WHITE, bottom: TOP + HEIGHT });
    }
    const x = left + (afterWhite(offset) + 1 - BLACK_W / 2) * WHITE;
    return fakeKey({
      left: x,
      top: TOP,
      right: x + BLACK_W * WHITE,
      bottom: TOP + BLACK_H * HEIGHT,
    });
  });
}

/** `count` folded keys (windsor#919): equal boxes `width` px wide side by side, no black keys. */
export function foldedRow(count: number, width = WHITE, top = TOP): FakeKey[] {
  return Array.from({ length: count }, (_, offset) =>
    fakeKey({ left: offset * width, top, right: (offset + 1) * width, bottom: top + HEIGHT }),
  );
}

/** A part that records what the keyboard asks of it, its velocities apart, and hands out note ids. */
export function fakePart(name: string, log: string[], velocities: number[] = []): AudioPart {
  let nextId = 0;
  return {
    noteOn: (note: number, velocity: number): number => {
      log.push(`${name} on ${note}`);
      velocities.push(velocity);
      return ++nextId;
    },
    noteOff: (id: number): void => void log.push(`${name} off #${id}`),
    panic: (): void => void log.push(`${name} panic`),
    pitchBend: { value: 0 },
    modWheel: { value: 0 },
  } as unknown as AudioPart;
}
/** A key the test expected the row to hold. */
function fail(offset: number): never {
  throw new Error(`no key at offset ${offset}`);
}

/** A pointer at the key `offset` of `keys`, `down` of the way down it (the middle by default). */
export function pointer(
  pointerId: number,
  keys: readonly FakeKey[],
  offset: number,
  { down = 0.5, type = 'touch', timeStamp = 0 } = {},
): PointerInput {
  const box = (keys[offset] ?? fail(offset)).el.getBoundingClientRect();
  return {
    pointerId,
    pointerType: type,
    clientX: (box.left + box.right) / 2,
    clientY: box.top + down * (box.bottom - box.top),
    timeStamp,
  };
}
/** A pointer at a point off every key: above the row. */
export const offRow = (pointerId: number, timeStamp = 0): PointerInput => ({
  pointerId,
  pointerType: 'touch',
  clientX: WHITE,
  clientY: TOP - HEIGHT,
  timeStamp,
});
