/**
 * The one formatter set (#618 decision 5). `fmtMs` resolved the two roundings
 * the console had one way: milliseconds under a second, seconds above — the
 * returns' delay time now reads like a glide.
 */
import { describe, expect, it } from 'vitest';

import {
  fmt0,
  fmt2,
  fmtHz,
  fmtMs,
  fmtSigned,
  fmtVowel,
  noteName,
  pitchClass,
} from './consoleFormat';

describe('console formatters', () => {
  it('print seconds as milliseconds under one second and as seconds above', () => {
    expect(fmtMs(0.02)).toBe('20m');
    expect(fmtMs(0.999)).toBe('999m');
    expect(fmtMs(1)).toBe('1.00s');
    expect(fmtMs(1.5)).toBe('1.50s');
  });

  it('print hertz whole and kilohertz to two places', () => {
    expect(fmtHz(440)).toBe('440');
    expect(fmtHz(999.6)).toBe('1000');
    expect(fmtHz(1000)).toBe('1.00k');
    expect(fmtHz(18000)).toBe('18.00k');
  });

  it('print signed and fixed-place values', () => {
    expect(fmtSigned(0)).toBe('+0.00');
    expect(fmtSigned(-0.5)).toBe('-0.50');
    expect(fmt2(0.7071)).toBe('0.71');
    expect(fmt0(3.6)).toBe('4');
  });

  it('name MIDI notes the way the keyboard does, negative notes included', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C#4');
    expect(noteName(59)).toBe('B3');
    expect(noteName(0)).toBe('C-1');
    expect(pitchClass(-1)).toBe(11);
  });

  it('print the vowel as a letter on the integers and the morph between them (windsor#334)', () => {
    expect([0, 1, 2, 3, 4].map(fmtVowel)).toEqual(['a', 'e', 'i', 'o', 'u']);
    expect(fmtVowel(3.25)).toBe('o→u 25%');
    expect(fmtVowel(0.5)).toBe('a→e 50%');
    expect(fmtVowel(3.999)).toBe('u');
    expect(fmtVowel(1.001)).toBe('e');
  });
});
