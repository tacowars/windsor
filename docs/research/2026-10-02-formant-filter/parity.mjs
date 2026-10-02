/* global Buffer, process, structuredClone */
/**
 * The five old filter modes render as before (windsor#331, acceptance): four
 * library presets, each forced through modes 0–4 at 12 and 24 dB, rendered by
 * the bundle before the change and by this branch's, each render hashed.
 * The patches carry no `vowel`, as every saved patch does. Research only.
 *
 *   node parity.mjs <repo> <before root>
 *
 * A root holds `scripts/sound-match/render.mjs` and the FM bundle it renders,
 * `packages/engine/src/worklet/generated/fm-processor.js`; `<before root>`
 * holds `origin/main`'s two files from before the change
 * (`git show origin/main:<path>`). One note, 2 s, a note-off at 1.2 s, seed 1.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRESETS = ['ai-voice', 'pad-drift', 'lead-bell', 'score-ghost-formants'];
const MODES = [0, 1, 2, 3, 4];
const RENDER = { seconds: 2, gate: 1.2, seed: 1, note: 57 };

async function renderer(root) {
  const url = pathToFileURL(join(root, 'scripts', 'sound-match', 'render.mjs'));
  return (await import(url.href)).renderNote;
}

const hash = (samples) =>
  createHash('sha256')
    .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
    .digest('hex')
    .slice(0, 16);

async function main() {
  const [repo, before] = process.argv.slice(2);
  if (!repo || !before) {
    process.stderr.write('usage: node parity.mjs <repo> <before root>\n');
    process.exit(2);
  }
  const render = { before: await renderer(before), after: await renderer(repo) };
  let same = 0;
  let total = 0;
  for (const id of PRESETS) {
    const file = join(repo, 'packages', 'engine', 'src', 'patches', `${id}.json`);
    const base = JSON.parse(readFileSync(file, 'utf8')).patch;
    for (const mode of MODES) {
      for (const slope24 of [false, true]) {
        const patch = structuredClone(base);
        patch.filter = { ...patch.filter, mode, slope24 };
        delete patch.filter.vowel;
        const a = hash(render.before(patch, RENDER));
        const b = hash(render.after(patch, RENDER));
        total++;
        if (a === b) same++;
        process.stdout.write(
          `${id.padEnd(22)} mode ${mode} ${slope24 ? '24' : '12'} dB  ${a}  ${b}  ${a === b ? 'same' : 'DIFFERENT'}\n`,
        );
      }
    }
  }
  process.stdout.write(`\n${same} of ${total} renders bit-identical\n`);
}

await main();
