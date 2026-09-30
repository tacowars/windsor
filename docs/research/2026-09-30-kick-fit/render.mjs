/* global process */
// node render.mjs <patch.json | library id> <note> <velocity> <out.wav> [seconds]
import { existsSync, readFileSync } from 'node:fs';

import { loadPatch, renderHit, writeWav } from './kick.mjs';

const [, , source, note, velocity, out, seconds = '0.6'] = process.argv;
const patch = existsSync(source) ? JSON.parse(readFileSync(source, 'utf8')) : loadPatch(source);
writeWav(out, renderHit(patch, { note: +note, vel: +velocity, seconds: +seconds }));
