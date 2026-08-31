/**
 * The audition keyboard (#70): plays the Parts tab's selected part through
 * the real engine — `part.noteOn`/`noteOff`, nothing local.
 */
import type { AudioPart } from '../../../packages/client/src/audio/index-for-editor';
import { $, el } from './dom';

const BLACK = new Set([1, 3, 6, 8, 10]);
const QWERTY: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
};

interface Held {
  id: number;
  part: AudioPart;
  el: HTMLElement | null;
}

export class Keyboard {
  octave = 4;
  hold = false;

  private readonly held = new Map<string, Held>();
  private readonly getPart: () => AudioPart | null;

  constructor(getPart: () => AudioPart | null) {
    this.getPart = getPart;
  }

  /** Build the keys into `box` and wire the octave label. */
  render(box: HTMLElement): void {
    box.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const key = el('div', 'key');
      key.dataset.offset = String(i);
      if (BLACK.has(i % 12)) key.dataset.black = '1';
      key.addEventListener('pointerdown', (e) => {
        key.setPointerCapture(e.pointerId);
        this.press('mouse', i, key);
      });
      const up = (): void => this.lift('mouse');
      key.addEventListener('pointerup', up);
      key.addEventListener('pointercancel', up);
      box.appendChild(key);
    }
    this.syncLabel();
  }

  /** Global QWERTY handling; call once. */
  attachGlobalKeys(): void {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const tag = (e.target instanceof HTMLElement ? e.target.tagName : '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'z') return this.shiftOctave(-1);
      if (e.key === 'x') return this.shiftOctave(1);
      const off = QWERTY[e.key];
      if (off === undefined || this.held.has(e.key)) return;
      this.press(e.key, off, ($('keys').children[off] as HTMLElement | undefined) ?? null);
    });
    addEventListener('keyup', (e) => this.lift(e.key));
  }

  shiftOctave(by: number): void {
    this.octave = Math.min(8, Math.max(0, this.octave + by));
    this.syncLabel();
  }

  panic(): void {
    this.getPart()?.panic();
    this.held.clear();
    document.querySelectorAll('.key.down').forEach((k) => k.classList.remove('down'));
  }

  private press(source: string, offset: number, keyEl: HTMLElement | null): void {
    const part = this.getPart();
    if (!part) return;
    const id = part.noteOn(this.octave * 12 + offset, 0.9);
    keyEl?.classList.add('down');
    this.held.set(source, { id, part, el: keyEl });
  }

  private lift(source: string): void {
    const held = this.held.get(source);
    if (!held) return;
    if (!this.hold) held.part.noteOff(held.id);
    held.el?.classList.remove('down');
    this.held.delete(source);
  }

  private syncLabel(): void {
    const label = document.getElementById('octLabel');
    if (label) label.textContent = `C${this.octave}`;
  }
}
