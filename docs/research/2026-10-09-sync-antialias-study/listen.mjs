/* global process, console, Buffer */
/**
 * The listening renders (windsor#652, decision 8): `lead-sync-sweep` through
 * each candidate's best variant, as 48 kHz 16-bit mono WAVs, for tacowars's
 * ear. Never committed. Research only.
 *
 *   node docs/research/2026-10-09-sync-antialias-study/listen.mjs [--out ~/Desktop/sync-study]
 *     [--variants shipped,shipped+D,A+D,C+D,B2+D,B4+D,AB2+D,ref16]
 *
 * Each file plays MIDI 60, 72 and 84 in turn, each held 8 s (two cycles of
 * the LFO's sweep) and released: the left channel 12 dB over the voice's own
 * level (`GAIN`), the same gain in every file so they compare by level too.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { SR, library, renderNote, variant } from './render.mjs';

const NOTES = [60, 72, 84];
const HOLD = 8;
const TAIL = 0.75;
const GAIN = 4;
const DEFAULT = 'shipped,shipped+D,A+D,C+D,B2+D,B4+D,AB2+D,ref16';

const args = { out: join(homedir(), 'Desktop', 'sync-study'), variants: DEFAULT, repo: '.' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}

/** `x` as a 16-bit mono WAV at 48 kHz. */
function wav(x) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i] * GAIN)) * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SR, 24);
  head.writeUInt32LE(SR * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const patch = library(args.repo, 'lead-sync-sweep');
mkdirSync(args.out, { recursive: true });
for (const name of args.variants.split(',')) {
  const v = variant(args.repo, name);
  const parts = NOTES.map((note) => renderNote(v, patch, note, HOLD + TAIL, HOLD));
  const x = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (x.set(p, at), at + p.length), 0);
  const file = join(args.out, `sync-sweep-${name.replace('+', '-plus-')}.wav`);
  writeFileSync(file, wav(x));
  console.log(
    `${file}: peak ${(GAIN * x.reduce((m, s) => Math.max(m, Math.abs(s)), 0)).toFixed(3)}`,
  );
}
