/**
 * The ACB half of the reference comparison (windsor#574, decision 6): the
 * eight TB-303 software instrument recordings tacowars made, read from the
 * folder they live in (never copied), each checked against the SHA-256
 * `settings.txt` lists, and measured note by note in a window inside the
 * held note. The recipe and the timeline are `settings.txt`'s: twelve notes,
 * MIDI 33, 45 and 57 in turn, a 2 s gate every 3 s from 2 s, in four Cut Off
 * sections held at 24.78, 49.38, 75.05 and 100 % of the knob's travel.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { measureNote, readWav } from './spectrum.mjs';

export const WAVES = ['saw', 'square'];
/** The Resonance knob's travel in each file, and its name's suffix. */
export const RESONANCES = [
  { travel: 0, suffix: '000' },
  { travel: 0.5, suffix: '050' },
  { travel: 0.9, suffix: '090' },
  { travel: 1, suffix: '100' },
];
/** The Cut Off knob's held travel, %, in each section (`settings.txt`, the Live set's values). */
export const SECTIONS = [24.7827, 49.3773, 75.053, 100];
export const NOTES = [33, 45, 57];
const FIRST_ONSET_S = 2;
const NOTE_EVERY_S = 3;
/** The window inside each held note, seconds after its onset (away from the gate's edges). */
export const WINDOW = { from: 0.5, to: 1.8 };

/** `settings.txt`'s SHA-256 of each recording. */
const SHA256 = {
  saw000: '56e3014391889e56f7d5517994ec188dac3943ac045cb4e8109879f77a4182f4',
  saw050: 'cd63a0b43b6cb02f2865b42fd2621c7d45435cc2465975d0526e3b82402590ee',
  saw090: '85ae7c8f98fd4c4d22d4d7dce97f82942caeae88fc70e514e47a56991d8c8b00',
  saw100: 'd2c7e2a4dd1fe8f75722dfb113322b20d6bb48075f2b8646dbdc43dc3e04c93b',
  square000: '167b8eb7b2aab789df98a8908f61e5775eb25e60bc9994c80913de599ad44c82',
  square050: 'bb740127ff7497e32499a035c9d5c7e21562c2ac30d0d4214f5d9b47b14ff0f1',
  square090: '616816f4617bb36399d30f50184ecbb39845420b580af62d889ef5ab4b7ad77b',
  square100: '3a1a966d5020c2edc9e0bf59f2798db9e6ad5aad7fac30d5c0d1d31699aeed64',
};

export const noteHz = (note) => 440 * 2 ** ((note - 69) / 12);

/** One recording, refused unless its bytes are the ones `settings.txt` lists. */
function readRecording(folder, wave, suffix) {
  const path = join(folder, `roland303_${wave}_res${suffix}.wav`);
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (digest !== SHA256[`${wave}${suffix}`]) {
    throw new Error(`${path}: SHA-256 ${digest} is not settings.txt's`);
  }
  return readWav(path);
}

/** Every note of every recording: `[wave][resonance][section][note]` readings. */
export function measureAcb(folder, maxHz) {
  return WAVES.map((wave) =>
    RESONANCES.map(({ suffix }) => {
      const { rate, samples } = readRecording(folder, wave, suffix);
      return SECTIONS.map((_, s) =>
        NOTES.map((note, n) =>
          measureNote(samples, rate, {
            onset: FIRST_ONSET_S + NOTE_EVERY_S * (s * NOTES.length + n),
            nominalHz: noteHz(note),
            maxHz,
            ...WINDOW,
          }),
        ),
      );
    }),
  );
}
