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
 *
 * One keyboard, one box (windsor#864): while the expanded view is open the
 * keys render into its box, in the rows its pick asks for, and back into the
 * Parts row when it closes. The octave label is every `[data-oct-label]`
 * and the Hold buttons every `[data-keys-hold]`, so the row's and the view's
 * show the same keyboard.
 *
 * Folded (windsor#919, record `2026-10-18-keyboard-fold`), the keys are the
 * fold's (`keyboardKeys.ts` over `keyboardFold.ts`), each key carrying its
 * own note, and the keys rebuild when the set changes: at a chord change, a
 * Fold tap, an undo or a part switch, read on the console's one frame loop
 * (`watchPlayhead`). A held note follows its note's keys; a held pointer
 * keeps its key and note through a rename (`keyboardHeld.ts`).
 */
import type { AudioPart } from '@windsor/engine';
import { MIDI_NOTE_MAX, SEMITONES_PER_OCTAVE } from '@windsor/engine';
import { releaseMousePickedDropdowns } from './keyboardDropdownFocus';
import {
  AUDITION_TAB,
  FIXED_VELOCITY,
  OCTAVE_DEFAULT,
  OCTAVE_MIN,
  QWERTY,
} from './keyboardConstants';
import type { KeysPick } from './keyboardConstants';
import { KeyboardExpression } from './keyboardExpression';
import type { PartFold } from './keyboardFold';
import { markFolds } from './keyboardFoldControl';
import type { FoldNow, KeyboardFoldHost } from './keyboardFoldNow';
import { foldSignature, partFoldOf, rowSlotsOf, setSignature } from './keyboardFoldNow';
import { followFinger, keysCarrying } from './keyboardHeld';
import { DEFAULT_SHAPE, chromaticLaid, homeSurface, layKeys, sameShape } from './keyboardKeys';
import type { KeysLaid, KeysSurface } from './keyboardKeys';
import { isBlackKey, keyAt, strikeVelocity } from './keyboardLayout';
import type { KeyBox, RowSlots } from './keyboardLayout';
import { octaveMaxFor } from './keyboardViewModel';
import type { PerformerSink } from './midiPerformer';
import type { NoteTap } from './rollRecorder';
import { watchPlayhead } from './stepStrip';

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
  /** The MIDI note it plays: its identity, which a re-render lights again on every key carrying it. */
  note: number;
  /** The shown keys carrying it, lit. */
  els: HTMLElement[];
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

/** One note struck: its pitch, velocity and input event's `timeStamp`. */
interface Strike {
  readonly note: number;
  readonly velocity: number;
  readonly timeStamp: number | undefined;
}

export class Keyboard {
  octave = OCTAVE_DEFAULT;
  hold = false;

  /** Called after Panic, so a MIDI performer can forget notes the part no longer sounds. */
  onPanic: (() => void) | null = null;

  /** Hears every note this keyboard starts and stops on a part: the Roll recorder (windsor#663). */
  tap: NoteTap | null = null;

  /** The played part's fold, and where a Fold tap writes it (windsor#919); null plays unfolded. */
  foldHost: KeyboardFoldHost | null = null;

  private readonly held = new Map<string, Held>();
  /** Every pointer down on the keys box, by `pointerId`. */
  private readonly fingers = new Map<number, Finger>();
  /** The row's keys by offset, as last rendered, and their boxes as last read. */
  private keyEls: readonly HTMLElement[] = [];
  private layout: readonly KeyBox[] = [];
  /** What the last build laid out: the octaves, each folded key's note, the folded label. */
  private laid: KeysLaid = chromaticLaid(0);
  /** The fold the keys were built for, and its signature, which the frame watch compares. */
  private builtFold: FoldNow | null = null;
  private builtSignature = 0;
  /** The C names of the view's keys, by octave. */
  private names: readonly HTMLElement[] = [];
  private shape: KeysPick = DEFAULT_SHAPE;
  /** The Parts row's box, the expanded view's while it is open, and the one the keys are in. */
  private home: KeysSurface | null = null;
  private view: KeysSurface | null = null;
  private surface: KeysSurface | null = null;
  /** Every box whose pointers are wired, so a box the keys come back to is wired once. */
  private readonly wired = new WeakSet<HTMLElement>();
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
  /** The controller's bend and wheel, on the part played. */
  private readonly expression: KeyboardExpression;

  constructor(getPart: () => AudioPart | null, qwertyLive: () => boolean = () => true) {
    this.getPart = getPart;
    this.qwertyLive = qwertyLive;
    this.expression = new KeyboardExpression(getPart);
  }

  /** How many notes the keyboard is holding; what Panic must leave at zero. */
  get heldCount(): number {
    return this.held.size;
  }

  /**
   * Take `box` as the Parts row's keys box, and build the keys into it unless
   * the expanded view has them. A new box (the Parts tab rendered again)
   * takes over the pointers still held, so their notes sound on and their
   * lifts arrive.
   */
  render(box: HTMLElement): void {
    this.home = homeSurface(box);
    if (!this.view) this.show(this.home);
    this.syncControls();
  }

  /** The expanded view opened (windsor#864): the keys move into its box, held pointers and all. */
  expand(view: KeysSurface): void {
    this.view = view;
    this.show(view);
  }

  /**
   * The expanded view closed: every pointer on its keys lifts (Hold keeps its
   * note), and the keys go back into the Parts row at the row's bound.
   */
  collapse(): void {
    this.view = null;
    for (const finger of this.fingers.values()) this.leaveKeys(finger);
    this.fingers.clear();
    if (this.home?.box.isConnected) return this.show(this.home);
    this.resizes?.disconnect();
    this.surface = null;
    this.adoptKeys([]);
  }

  /** Lay the keys out again for their box's room: after a resize, or a pick in the view. */
  relayout(): void {
    const shape = this.surface?.shape(this.rowSlots());
    if (!this.surface || !shape) return;
    if (sameShape(shape, this.shape)) this.readLayout();
    else this.build(this.surface);
  }

  /** What a row of a pick is counted in: the slots of the fold the keys show, or white keys. */
  rowSlots(): RowSlots {
    return rowSlotsOf(this.builtFold);
  }

  /** A Fold tap: the played part takes `fold`, one undo step, and the keys follow at once. */
  chooseFold(fold: PartFold): void {
    this.foldHost?.write(fold);
    this.refold();
  }

  /** Hold on or off, on every Hold button; turning it off is a Panic. */
  toggleHold(): void {
    this.hold = !this.hold;
    this.syncControls();
    if (!this.hold) this.panic();
  }

  /**
   * Take `keys` as the row's keys by offset, the one refresh after a render
   * (windsor#879 decisions 1 and 2): read their boxes again, light the held
   * notes' keys, and lift a held pointer whose key is gone. A pointer whose
   * key is still shown keeps its note until its next move, which the new
   * boxes judge. `laid` says what they are: chromatic from the octave by
   * default, or a fold's keys with their notes.
   */
  adoptKeys(keys: readonly HTMLElement[], laid: KeysLaid = chromaticLaid(keys.length)): void {
    this.laid = laid;
    this.octave = Math.min(this.octave, octaveMaxFor(laid.octaves));
    this.keyEls = keys;
    this.followNotes(laid.renamed);
    this.readLayout();
  }

  /**
   * Light each held note's keys at the octave and keys as they are now: a
   * note is its holder's identity, not its key (record
   * `2026-10-17-keyboard-geometry-follows-the-layout`). Each pointer goes
   * where `followFinger` says: to its note's key, or lifted when none shows
   * it, except through a fold's rename, which keeps its key and its note.
   */
  private followNotes(renamed = false): void {
    // Every light goes off before any comes on: one note's new key may be another's old.
    for (const held of this.held.values()) for (const key of held.els) key.classList.remove('down');
    for (const held of this.held.values()) {
      held.els = this.keyElsFor(held.note);
      for (const key of held.els) key.classList.add('down');
    }
    for (const finger of this.fingers.values()) {
      const held = finger.source === null ? undefined : this.held.get(finger.source);
      const carriers = held ? this.keysFor(held.note) : null;
      const count = this.keyEls.length;
      const after = followFinger({ offset: finger.offset, carriers, count, renamed });
      if (after === 'lift') this.leaveKeys(finger);
      else finger.offset = after.offset;
    }
  }

  /** The note the key at `offset` plays: the fold's, or the octave's C plus the offset. */
  private noteOf(offset: number): number | null {
    const { notes } = this.laid;
    return notes ? (notes[offset] ?? null) : this.octave * SEMITONES_PER_OCTAVE + offset;
  }

  /** The offsets of the shown keys carrying `note`. */
  private keysFor(note: number): number[] {
    if (this.laid.notes) return keysCarrying(note, this.laid.notes);
    const offset = note - this.octave * SEMITONES_PER_OCTAVE;
    return offset >= 0 && offset < this.keyEls.length ? [offset] : [];
  }

  /** The shown keys carrying `note`. */
  private keyElsFor(note: number): HTMLElement[] {
    return this.keysFor(note).flatMap((offset) => this.keyEls[offset] ?? []);
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
    this.play(e.code, { note, velocity: FIXED_VELOCITY, timeStamp: e.timeStamp });
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
   * it strikes that key's note and then lifts the one it left, at the
   * velocity it first struck with; a note another pointer holds takes no
   * second one, so the arriving pointer only lifts its own, and a key past
   * the range strikes nothing. Onto another key carrying its own note (two
   * rows share their closing note) it holds on. Off every key it lifts, and
   * it strikes afresh when it is back on a key.
   */
  onPointerMove(e: PointerInput): void {
    const finger = this.fingers.get(e.pointerId);
    if (!finger) return;
    const point = { x: e.clientX, y: e.clientY };
    const key = keyAt(point, this.layout);
    if (!key) return this.leaveKeys(finger, e.timeStamp);
    if (key.offset === finger.offset) return;
    const note = this.noteOf(key.offset);
    const left = finger.source;
    finger.offset = key.offset;
    if (left !== null && this.held.get(left)?.note === note) return;
    finger.source = null;
    if (note !== null && note <= MIDI_NOTE_MAX && !this.pointerHolds(note)) {
      // A mouse strikes at `FIXED_VELOCITY`; a touch or pen by where it lands on the key (decision 6).
      finger.velocity ??= e.pointerType === 'mouse' ? FIXED_VELOCITY : strikeVelocity(point, key);
      const source = pointerSource(e.pointerId, note);
      this.play(source, { note, velocity: finger.velocity, timeStamp: e.timeStamp });
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

  /**
   * Shift the keys by octaves, within the bound of the octaves shown (record
   * decision 8). Folded keys carry their notes, so they are built again.
   */
  shiftOctave(by: number): void {
    const max = octaveMaxFor(this.laid.octaves);
    this.octave = Math.min(max, Math.max(OCTAVE_MIN, this.octave + by));
    if (this.laid.notes && this.surface) return this.build(this.surface);
    this.followNotes();
    this.syncControls();
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
    this.expression.rest();
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
    this.expression.follow();
  }

  /** One MIDI input's view of this keyboard: real note numbers, real velocity, its own held notes. */
  midiSink(inputId: string): PerformerSink {
    return {
      press: (note, velocity, timeStamp) =>
        this.play(`midi:${inputId}:${note}`, { note, velocity, timeStamp }),
      release: (note, force, timeStamp) => this.lift(`midi:${inputId}:${note}`, force, timeStamp),
      bend: (semitones) => this.expression.bend(semitones),
      modWheel: (value) => this.expression.modWheel(value),
    };
  }

  private play(source: string, strike: Strike): void {
    const part = this.getPart();
    if (!part) return;
    const { note, velocity, timeStamp } = strike;
    const id = part.noteOn(note, velocity);
    this.sounded.add(part);
    const els = this.keyElsFor(note);
    for (const key of els) key.classList.add('down');
    this.held.set(source, { id, part, note, els });
    this.tap?.press(part, source, note, velocity, timeStamp);
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
    for (const key of held.els) key.classList.remove('down');
    this.held.delete(source);
  }

  /** Whether some pointer is holding `note` down. */
  private pointerHolds(note: number): boolean {
    for (const [source, held] of this.held)
      if (held.note === note && source.startsWith(POINTER_SOURCE_PREFIX)) return true;
    return false;
  }

  /** Read every key's box: the one place the layout touches the page. Folded keys are all whites. */
  private readLayout(): void {
    const folded = this.laid.notes !== null;
    this.layout = this.keyEls.map((key, offset) => {
      const { left, top, right, bottom } = key.getBoundingClientRect();
      return { offset, black: !folded && isBlackKey(offset), left, top, right, bottom };
    });
  }

  /**
   * Put the keys in `surface`'s box, wired and watched, in the shape its room
   * takes; a box they move out of is left empty.
   */
  private show(surface: KeysSurface): void {
    const moved = surface.box !== this.surface?.box;
    if (moved) {
      this.surface?.box.replaceChildren();
      this.watch(surface.box);
    }
    this.surface = surface;
    this.build(surface);
    if (moved) this.watchFold(surface);
  }

  /**
   * Build the keys into `surface` for the played part's fold as it stands:
   * the shape its room takes for the fold's slots, the octave bounded by the
   * octaves shown, and the fold's keys or the chromatic ones. A change of
   * the set since the last build is a rename (`KeysLaid.renamed`).
   */
  private build(surface: KeysSurface): void {
    const now = this.foldHost?.now() ?? null;
    const renamed = setSignature(now) !== setSignature(this.builtFold);
    const { keys, names, shape, laid } = layKeys(surface, now, this.octave, renamed);
    this.shape = shape;
    this.names = names;
    this.builtFold = now;
    this.builtSignature = foldSignature(now);
    this.adoptKeys(keys, laid);
    this.syncControls();
    surface.built?.();
  }

  /** Build the keys again when the played part's fold no longer shows what they show. */
  private refold(): void {
    const now = this.foldHost?.now() ?? null;
    if (this.surface && foldSignature(now) !== this.builtSignature) this.build(this.surface);
  }

  /**
   * Watch the fold while the keys are in `surface` (record decision 5): on
   * the console's one frame loop, each frame the box is shown, the fold's
   * signature; a chord change, a Fold tap, an undo or a part switch moves
   * it, and the keys rename. The watch ends when the keys leave the box.
   */
  private watchFold(surface: KeysSurface): void {
    const host = this.foldHost;
    if (!host) return;
    watchPlayhead({
      attached: () => this.surface === surface && surface.box.isConnected,
      shown: () => surface.box.closest('[hidden]') === null,
      playheadAt: () => foldSignature(host.now()),
      mark: () => this.refold(),
    });
  }

  /**
   * Wire a new keys box: its pointers, once, the pointers still held on the
   * old one, and a `ResizeObserver` that lays the keys out again on every
   * resize (record decision 10, windsor#879).
   */
  private watch(box: HTMLElement): void {
    this.resizes?.disconnect();
    if (!this.wired.has(box)) this.wire(box);
    for (const [pointerId, finger] of this.fingers) {
      try {
        box.setPointerCapture(pointerId);
      } catch {
        // That pointer is no longer down: nothing will lift it but this.
        this.fingers.delete(pointerId);
        this.leaveKeys(finger);
      }
    }
    this.resizes = new ResizeObserver(() => this.relayout());
    this.resizes.observe(box);
  }

  /** A box's pointers, which play only while the keys are in it. */
  private wire(box: HTMLElement): void {
    this.wired.add(box);
    const mine = (): boolean => this.surface?.box === box;
    box.addEventListener('pointerdown', (e) => {
      if (!mine()) return;
      box.setPointerCapture(e.pointerId);
      this.onPointerDown(e);
    });
    box.addEventListener('pointermove', (e) => mine() && this.onPointerMove(e));
    const up = (e: PointerEvent): void => this.onPointerUp(e);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  }

  /**
   * The octave on every label (the first folded key, folded) and the view's
   * C names, the fold on every Fold control, and Hold on every Hold button.
   */
  private syncControls(): void {
    const label = this.laid.notes ? this.laid.label : `C${this.octave}`;
    for (const node of document.querySelectorAll('[data-oct-label]')) node.textContent = label;
    this.names.forEach((name, octave) => (name.textContent = `C${this.octave + octave}`));
    markFolds(partFoldOf(this.builtFold));
    for (const button of document.querySelectorAll('[data-keys-hold]'))
      button.setAttribute('aria-pressed', String(this.hold));
  }
}
