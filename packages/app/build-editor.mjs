/* global console, Buffer */
/**
 * Generates the standalone patch editor.
 *
 * The editor must run as one file with no imports and no dev server, so this
 * inlines two things into `editor-template.html`:
 *
 *   - `worklet/fm-processor.js` verbatim, as a string the page turns into a
 *     blob or data URL for `addModule()`
 *   - `patch.ts` + `presets.ts`, bundled by esbuild into an IIFE
 *
 * Both come from the real client source, so the editor cannot drift from what
 * the game runs. Re-run after changing the DSP or the patch schema:
 *
 *   node tools/patch-editor/build-editor.mjs
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(HERE, '../../packages/client/src/audio');

/** Names the template expects in scope. */
const EXPORTS = [
  'ALGORITHMS',
  'FILTER_MODE_NAMES',
  'LFO_SHAPE_NAMES',
  'LOOP_MODE_NAMES',
  'PRESETS',
  'PRESET_NAMES',
  'WAVE_NAMES',
  'clonePatch',
  'makePatch',
];

const worklet = readFileSync(join(AUDIO, 'worklet/fm-processor.js'), 'utf8');
const template = readFileSync(join(HERE, 'editor-template.html'), 'utf8');

for (const marker of ['/*__WORKLET__*/', '/*__PATCH__*/']) {
  if (!template.includes(marker)) throw new Error(`template is missing ${marker}`);
}

const bundle = await build({
  stdin: {
    contents: `export { ${EXPORTS.join(', ')} } from './index-for-editor';`,
    resolveDir: AUDIO,
    sourcefile: 'editor-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: '__SCHEMA__',
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
});

const [output] = bundle.outputFiles;
if (!output) throw new Error('esbuild produced no output');

const schema = `${output.text}\nconst { ${EXPORTS.join(', ')} } = __SCHEMA__;`;

let html = template
  .replace('/*__PATCH__*/', () => schema)
  .replace('/*__WORKLET__*/', () => JSON.stringify(worklet));

// The editor is published as an Artifact, which supplies its own document
// skeleton. Match whole tags so <header> does not trip the guard.
for (const forbidden of [/<!doctype/i, /<html[\s>]/i, /<head[\s>]/i, /<body[\s>]/i]) {
  const hit = html.match(forbidden);
  if (hit) throw new Error(`generated file must not contain "${hit[0]}"`);
}

const dest = join(HERE, 'patch-editor.html');
writeFileSync(dest, html);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`built tools/patch-editor/patch-editor.html (${kb(Buffer.byteLength(html))})`);
console.log(`  worklet: ${kb(worklet.length)}   schema bundle: ${kb(output.text.length)}`);
