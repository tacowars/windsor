/**
 * The audition keyboard (#70): plays the Parts tab's selected part through
 * the real engine — `part.noteOn`/`noteOff`, nothing local. Its QWERTY keys
 * play only while the Parts tab is shown (windsor#349), so another tab's own
 * keys (the Song tab's M and S) never sound a note; MIDI input plays anywhere.
 *
 * Its `tap` (windsor#663, the Roll recorder) hears each note where it really
 * starts and stops on the part: `play`, and a `lift` that sends the note-off,
 * each with its input event's `timeStamp`. A release Hold keeps reaches the
 * tap only when the voice stops (a forced lift, or Panic, which the tap
 * hears as one); the sustain pedal's is `MidiPerformer`'s, which lifts on
 * pedal up.
 *
 * Its keys box captures every pointer (windsor#863): the key under a point
 * comes from `keyAt` over the keys' boxes, read on the first pointer down and
 * again after every re-render or resize, so a finger that slides along the
 * row plays each key it crosses. A touch or pen strikes harder the further
 * down the key it lands. On a touch layout the box's room sets the octaves
 * it shows (record `2026-10-17-the-keyboard-on-a-tablet`, amended by
 * `2026-10-17-keyboard-geometry-follows-the-layout`).
 */
import type { AudioPart } from '@windsor/engine';
import { SEMITONES_PER_OCTAVE } from '@windsor/engine';
import { el } from './dom';
import {
  AUDITION_TAB,
  COARSE_POINTER_QUERY,
  FIXED_VELOCITY,
  KEY_COUNT,
  OCTAVE_DEFAULT,
  OCTAVE_MAX,
  OCTAVE_MIN,
  QWERTY,
  TOUCH_ROW_CSS,
} from './keyboardConstants';
import {
  afterWhite,
  isBlackKey,
  keyAt,
  keyCountFor,
  octavesFor,
  strikeVelocity,
  whiteCount,
} from './keyboardLayout';
import type { KeyBox, Point } from './keyboardLayout';
import type { PerformerSink } from './midiPerformer';
import type { NoteTap } from './rollRecorder';

/**
 * A dropdown picked with the mouse keeps focus, and the note keys above are
 * ignored inside a select (a letter there would change its value), so every
 * pick — wave, filter, preset category — cost a click away before auditioning.
 * A mouse pick now hands focus back; a keyboard user arrowing through the
 * options keeps it. Listboxes (`size` > 1) are left to their owners.
 */
function releaseMousePickedDropdowns(): void {
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

/** Whether the QWERTY keys play while `activeTab` is shown: only on the audition tab. */
export const qwertyPlaysOn = (activeTab: string | null, auditionTab = AUDITION_TAB): boolean =>
  activeTab === auditionTab;

/**
 * Whether a press is a shortcut rather than a note: anything held with Ctrl,
 * Meta or Alt. ⌘K opening the patch search used to strike the `k` key's C
 * as well (windsor#521), and Ctrl+Z shifted the octave; no chord plays.
 * Shift is left alone: it changes `e.key`, and a shifted letter maps to no key.
 */
export const isShortcutPress = (
  e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>,
): boolean => e.ctrlKey || e.metaKey || e.altKey;

interface Held {
  id: number;
  part: AudioPart;
  /** The MIDI note it plays, for the tap's release. */
  note: number;
  /** Its key's offset in the row, which a re-render lights again; may lie outside the row. */
  offset: number;
  el: HTMLElement | null;
}

/** What a pointer handler reads of its event: which pointer, its kind, where and when. */
export type PointerInput = Pick<
  PointerEvent,
  'pointerId' | 'pointerType' | 'clientX' | 'clientY' | 'timeStamp'
>;

/** One pointer down on the keys: the key under it, the note it holds, the velocity it struck with. */
interface Finger {
  offset: number | null;
  source: string | null;
  velocity: number | null;
}

const POINTER_SOURCE_PREFIX = 'pointer:';

/**
 * A pointer's held-note source, named like MIDI's `midi:<input>:<note>`: a
 * slide's strike and lift are two entries, so the tap records two notes.
 */
const pointerSource = (pointerId: number, note: number): string =>
  `${POINTER_SOURCE_PREFIX}${pointerId}:${note}`;

/** One note struck: its pitch, velocity, key and input event's `timeStamp`. */
interface Strike {
  readonly note: number;
  readonly velocity: number;
  readonly offset: number;
  readonly keyEl: HTMLElement | null;
  readonly timeStamp: number | undefined;
}

/**
 * The room a keys box may take: its row's content width. The box itself is
 * that wide whenever it shows two octaves (its `min-width` is 616 px capped
 * at the row), but at one octave it shares a line with the buttons, so its
 * own width would keep it at one octave on a row that has room for two.
 */
function roomFor(box: HTMLElement): number {
  const row = box.parentElement;
  if (!row) return box.clientWidth;
  const style = getComputedStyle(row);
  return row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

export class Keyboard {
  octave = OCTAVE_DEFAULT;
  hold = false;

  /** Called after Panic, so a MIDI performer can forget notes the part no longer sounds. */
  onPanic: (() => void) | null = null;

  /** Hears every note this keyboard starts and stops on a part: the Roll recorder (windsor#663). */
  tap: NoteTap | null = null;

  private readonly held = new Map<string, Held>();
  /** Every pointer down on the keys box, by `pointerId`. */
  private readonly fingers = new Map<number, Finger>();
  /** The row's keys by offset, as last rendered, and their boxes as last read. */
  private keyEls: readonly HTMLElement[] = [];
  private layout: readonly KeyBox[] = [];
  private box: HTMLElement | null = null;
  private resizes: ResizeObserver | null = null;
  /**
   * Every part this keyboard has struck a note on since the last Panic (#617).
   * `held` is not enough: under Hold a keyup drops the entry without a
   * `noteOff`, so the note lives on the engine alone and no map remembers
   * which part is carrying it.
   */
  private readonly sounded = new Set<AudioPart>();
  private readonly getPart: () => AudioPart | null;
  /** Whether a QWERTY press plays now; a release always lifts its note. */
  private readonly qwertyLive: () => boolean;
  /** The part carrying the controller's bend and wheel, and their positions. */
  private expressionPart: AudioPart | null = null;
  private bendSemitones = 0;
  private wheel = 0;

  constructor(getPart: () => AudioPart | null, qwertyLive: () => boolean = () => true) {
    this.getPart = getPart;
    this.qwertyLive = qwertyLive;
  }

  /** How many notes the keyboard is holding; what Panic must leave at zero. */
  get heldCount(): number {
    return this.held.size;
  }

  /**
   * Build the keys into `box`, wire its pointers and watch its size, and wire
   * the octave label. A new box (the Parts tab rendered again) takes over the
   * pointers still held, so their notes sound on and their lifts arrive.
   */
  render(box: HTMLElement): void {
    if (box !== this.box) this.watch(box);
    this.build(box, this.keyEls.length || KEY_COUNT);
    this.syncLabel();
  }

  /**
   * Take `keys` as the row's keys by offset, the one refresh after a render
   * (windsor#879 decisions 1 and 2): read their boxes again, light the held
   * notes' keys, and lift a held pointer whose key is gone. A pointer whose
   * key is still shown keeps its note until its next move, which the new
   * boxes judge.
   */
  adoptKeys(keys: readonly HTMLElement[]): void {
    for (const finger of this.fingers.values()) {
      if (finger.offset === null || finger.offset < keys.length) continue;
      this.leaveKeys(finger);
    }
    this.keyEls = keys;
    for (const held of this.held.values()) {
      held.el = keys[held.offset] ?? null;
      held.el?.classList.add('down');
    }
    this.readLayout();
  }

  /** Global QWERTY handling; call once. */
  attachGlobalKeys(): void {
    addEventListener('keydown', (e) => this.onKeyDown(e));
    addEventListener('keyup', (e) => this.onKeyUp(e));
    releaseMousePickedDropdowns();
  }

  /**
   * One QWERTY press. The note comes from `e.key` — the letter printed on the
   * key — but the held note is filed under `e.code`, the physical key (#617):
   * press `a`, take Shift to fine-drag a knob, release, and the keyup arrives
   * as `A`. Keyed by `e.key` that release found nothing to lift, the note rang
   * on, and every later `a` returned early because the map still held it.
   */
  onKeyDown(e: KeyboardEvent): void {
    if (e.repeat || isShortcutPress(e) || !this.qwertyLive()) return;
    const tag = (e.target instanceof HTMLElement ? e.target.tagName : '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    // A modal's buttons are not keys either (#563): focus is trapped there until it closes.
    if (e.target instanceof HTMLElement && e.target.closest('dialog[open]')) return;
    if (e.key === 'z') return this.shiftOctave(-1);
    if (e.key === 'x') return this.shiftOctave(1);
    const off = QWERTY[e.key];
    if (off === undefined || this.held.has(e.code)) return;
    const note = this.octave * SEMITONES_PER_OCTAVE + off;
    this.play(e.code, { note, velocity: FIXED_VELOCITY, ...this.keyOf(off, e) });
  }

  /** One QWERTY release, by physical key so a Shift change between the two still lifts. */
  onKeyUp(e: KeyboardEvent): void {
    this.lift(e.code, false, e.timeStamp);
  }

  /**
   * One pointer down on the keys box (windsor#859, windsor#863). The first
   * pointer down reads the keys' boxes; then the point is judged as a move.
   * Each pointer holds its own notes, so two fingers hold two and each lift
   * stops its own.
   */
  onPointerDown(e: PointerInput): void {
    if (this.fingers.has(e.pointerId)) return;
    if (this.fingers.size === 0) this.readLayout();
    this.fingers.set(e.pointerId, { offset: null, source: null, velocity: null });
    this.onPointerMove(e);
  }

  /**
   * A pointer down on the keys moved (record decision 5). Onto another key,
   * it strikes that key and then lifts the one it left, at the velocity it
   * first struck with; a key another pointer holds takes no second one, so
   * the arriving pointer only lifts its own. Off every key it lifts, and it
   * strikes afresh when it is back on a key.
   */
  onPointerMove(e: PointerInput): void {
    const finger = this.fingers.get(e.pointerId);
    if (!finger) return;
    const point = { x: e.clientX, y: e.clientY };
    const key = keyAt(point, this.layout);
    if (!key) return this.leaveKeys(finger, e.timeStamp);
    if (key.offset === finger.offset) return;
    const left = finger.source;
    finger.offset = key.offset;
    finger.source = null;
    if (!this.pointerHolds(key.offset)) {
      finger.velocity ??= this.velocityOf(e, point, key);
      const note = this.octave * SEMITONES_PER_OCTAVE + key.offset;
      const source = pointerSource(e.pointerId, note);
      // The octave moved under the finger and the new key plays the note it holds.
      if (source === left) this.lift(left, false, e.timeStamp);
      this.play(source, { note, velocity: finger.velocity, ...this.keyOf(key.offset, e) });
      finger.source = source;
    }
    if (left !== null && left !== finger.source) this.lift(left, false, e.timeStamp);
  }

  /** One pointer lifted or canceled: its own note stops, unless Hold keeps it. */
  onPointerUp(e: PointerInput): void {
    const finger = this.fingers.get(e.pointerId);
    if (!finger) return;
    this.fingers.delete(e.pointerId);
    if (finger.source !== null) this.lift(finger.source, false, e.timeStamp);
  }

  shiftOctave(by: number): void {
    this.octave = Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, this.octave + by));
    this.syncLabel();
  }

  /**
   * Silence every part this keyboard has sounded, not just the selected one
   * (#617): under Hold a note lives on the engine with nothing left to
   * release it, so switching parts used to strand it — Panic reached the new
   * part while the old one rang on. Hold keeps the latched notes across a
   * part switch, which is what Hold is for; Panic is what lets them all go.
   */
  panic(): void {
    this.tap?.panic();
    const selected = this.getPart();
    if (selected) this.sounded.add(selected);
    for (const part of this.sounded) part.panic();
    this.sounded.clear();
    this.held.clear();
    document.querySelectorAll('.key.down').forEach((k) => k.classList.remove('down'));
    this.bendSemitones = 0;
    this.wheel = 0;
    this.followPart();
    this.onPanic?.();
  }

  /**
   * Hand the controller's bend and wheel to the selected part: the part that
   * had them returns to rest, the new one takes the current positions. The
   * selection's listener calls this on every switch, from either view
   * (`ctx.parts.onSelect`, wired in `main.ts`); every expression change
   * does too.
   */
  followPart(): void {
    const part = this.getPart();
    if (this.expressionPart && this.expressionPart !== part) {
      this.expressionPart.pitchBend.value = 0;
      this.expressionPart.modWheel.value = 0;
    }
    this.expressionPart = part;
    if (part) {
      part.pitchBend.value = this.bendSemitones;
      part.modWheel.value = this.wheel;
    }
  }

  /** One MIDI input's view of this keyboard: real note numbers, real velocity, its own held notes. */
  midiSink(inputId: string): PerformerSink {
    return {
      press: (note, velocity, timeStamp) => {
        const offset = note - this.octave * SEMITONES_PER_OCTAVE;
        this.play(`midi:${inputId}:${note}`, {
          note,
          velocity,
          offset,
          keyEl: this.keyEls[offset] ?? null,
          timeStamp,
        });
      },
      release: (note, force, timeStamp) => this.lift(`midi:${inputId}:${note}`, force, timeStamp),
      bend: (semitones) => {
        this.bendSemitones = semitones;
        this.followPart();
      },
      modWheel: (value) => {
        this.wheel = value;
        this.followPart();
      },
    };
  }

  /** The key at `offset`, if the row shows it, and the input event's `timeStamp`. */
  private keyOf(
    offset: number,
    e: { readonly timeStamp: number },
  ): Pick<Strike, 'offset' | 'keyEl' | 'timeStamp'> {
    return { offset, keyEl: this.keyEls[offset] ?? null, timeStamp: e.timeStamp };
  }

  private play(source: string, strike: Strike): void {
    const part = this.getPart();
    if (!part) return;
    const { note, velocity, offset, keyEl, timeStamp } = strike;
    const id = part.noteOn(note, velocity);
    this.sounded.add(part);
    keyEl?.classList.add('down');
    this.held.set(source, { id, part, note, offset, el: keyEl });
    this.tap?.press(part, source, note, velocity, timeStamp);
  }

  /** A mouse strikes at `FIXED_VELOCITY`; a touch or pen by where it lands on the key (decision 6). */
  private velocityOf(e: PointerInput, point: Point, key: KeyBox): number {
    return e.pointerType === 'mouse' ? FIXED_VELOCITY : strikeVelocity(point, key);
  }

  /** A pointer off every key: its note lifts, and its next key strikes afresh. */
  private leaveKeys(finger: Finger, timeStamp?: number): void {
    const left = finger.source;
    Object.assign(finger, { offset: null, source: null, velocity: null });
    if (left !== null) this.lift(left, false, timeStamp);
  }

  /** A key let go: its note stops unless Hold keeps it (`force` stops it anyway). */
  private lift(source: string, force = false, timeStamp?: number): void {
    const held = this.held.get(source);
    if (!held) return;
    if (!this.hold || force) {
      held.part.noteOff(held.id);
      this.tap?.release(held.part, source, held.note, timeStamp);
    }
    held.el?.classList.remove('down');
    this.held.delete(source);
  }

  /** Whether some pointer is holding the key at `offset` down. */
  private pointerHolds(offset: number): boolean {
    for (const [source, held] of this.held)
      if (held.offset === offset && source.startsWith(POINTER_SOURCE_PREFIX)) return true;
    return false;
  }

  /** Read every key's box: the one place the layout touches the page. */
  private readLayout(): void {
    this.layout = this.keyEls.map((key, offset) => {
      const { left, top, right, bottom } = key.getBoundingClientRect();
      return { offset, black: isBlackKey(offset), left, top, right, bottom };
    });
  }

  /** Build `count` keys into `box`, with the custom properties the touch row is laid out from. */
  private build(box: HTMLElement, count: number): void {
    box.innerHTML = '';
    const keys: HTMLElement[] = [];
    for (let offset = 0; offset < count; offset++) {
      const key = el('div', 'key');
      key.dataset.offset = String(offset);
      if (isBlackKey(offset)) {
        key.dataset.black = '1';
        key.style.setProperty('--after-white', String(afterWhite(offset)));
      }
      keys.push(key);
    }
    for (const [name, value] of Object.entries(TOUCH_ROW_CSS)) box.style.setProperty(name, value);
    box.style.setProperty('--whites', String(whiteCount(count)));
    box.append(...keys);
    this.adoptKeys(keys);
  }

  /**
   * Wire a new keys box: its pointers, the pointers still held on the old one,
   * and a `ResizeObserver` that reads the boxes again on every resize and, on
   * a touch layout, shows the octaves its room allows (record decision 10).
   */
  private watch(box: HTMLElement): void {
    this.resizes?.disconnect();
    this.box = box;
    box.addEventListener('pointerdown', (e) => {
      box.setPointerCapture(e.pointerId);
      this.onPointerDown(e);
    });
    box.addEventListener('pointermove', (e) => this.onPointerMove(e));
    const up = (e: PointerEvent): void => this.onPointerUp(e);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
    for (const [pointerId, finger] of this.fingers) {
      try {
        box.setPointerCapture(pointerId);
      } catch {
        // That pointer is no longer down: nothing will lift it but this.
        this.fingers.delete(pointerId);
        this.leaveKeys(finger);
      }
    }
    this.resizes = new ResizeObserver(() => this.onResize(box));
    this.resizes.observe(box);
  }

  /** The keys box resized: show the octaves its room allows, else read the boxes again. */
  private onResize(box: HTMLElement): void {
    const room = roomFor(box);
    if (room === 0) return; // The Parts tab is hidden.
    const count = matchMedia(COARSE_POINTER_QUERY).matches
      ? keyCountFor(octavesFor(room))
      : KEY_COUNT;
    if (count === this.keyEls.length) this.readLayout();
    else this.build(box, count);
  }

  private syncLabel(): void {
    const label = document.getElementById('octLabel');
    if (label) label.textContent = `C${this.octave}`;
  }
}
