/* global process */
// node render.mjs <patch.json | library file | library id> <note> <velocity> <out.wav> [seconds]
import { existsSync, readFileSync } from 'node:fs';

import { loadPatch, renderHit, writeWav } from './kick.mjs';

const [, , source, note, velocity, out, seconds = '0.6'] = process.argv;
// A library file wraps its patch in `{ format, name, …, patch }`; a fitted one is bare.
const parsed = existsSync(source) ? JSON.parse(readFileSync(source, 'utf8')) : null;
const patch = parsed === null ? loadPatch(source) : (parsed.patch ?? parsed);
writeWav(out, renderHit(patch, { note: +note, vel: +velocity, seconds: +seconds }));
