/* global console, process, Buffer */
/**
 * Generates the standalone arrangement console (#70).
 *
 * The console must run as one file with no imports and no dev server — from
 * file:// or any static server — so this inlines into `editor-template.html`:
 *
 *   - `worklet/generated/fm-processor.js` (the bundle of `worklet/fm/`) and `worklet/reverb-processor.js` verbatim, as
 *     strings the page turns into blob URLs for `FmEngine.init()`
 *   - the console app (`src/main.ts`), bundled (`lib/audioBundle.mjs`) together
 *     with the real engine via `packages/client/src/audio/index-for-editor.ts`
 *
 * Everything comes from the real client source, so the console cannot drift
 * from what the game runs — and two assertions keep the two boundaries honest:
 *
 *   - the bundle must contain no Babylon (`index-for-editor` excludes
 *     `babylonBridge.ts`, the sole Babylon-touching module);
 *   - the console's own code (template + src/) must build no Web Audio nodes
 *     for synthesis, routing or sequencing — it drives `AudioSystem`.
 *
 * Re-run after changing the DSP, the schema, the engine, or the console:
 *
 *   node tools/patch-editor/build-editor.mjs
 *
 * The page is checked, not trusted (#620 decision 6): `--check` builds to
 * memory and exits 1 when the tracked page differs, and `npm run verify` runs
 * it after `build`, so a source edit without a rebuild fails the gate.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUDIO_DIR, bundleConsoleApp } from './lib/audioBundle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = AUDIO_DIR;
const CHECK = process.argv.includes('--check');

const worklet = readFileSync(join(AUDIO, 'worklet/generated/fm-processor.js'), 'utf8');
const compressor = readFileSync(join(AUDIO, 'worklet/generated/compressor-processor.js'), 'utf8');
const reverb = readFileSync(join(AUDIO, 'worklet/reverb-processor.js'), 'utf8');
const template = readFileSync(join(HERE, 'editor-template.html'), 'utf8');

for (const marker of ['/*__WORKLET__*/', '/*__REVERB__*/', '/*__COMPRESSOR__*/', '/*__APP__*/']) {
  if (!template.includes(marker)) throw new Error(`template is missing ${marker}`);
}

// The console is a complete standalone document (decision record
// `2026-08-31-arrangement-console-and-runtime-arrangements`, "local tool"):
// it is no longer published as an Artifact, so it carries its own skeleton.
if (!/^<!doctype html>/i.test(template.trim())) {
  throw new Error('template must be a complete document starting with <!doctype html>');
}

// A rule that loses its closing brace swallows the rest of the stylesheet:
// #610's Euclidean block landed inside `.chord-strip … .grid-idx` and every
// later rule became a nested selector that matched nothing, so the console
// rendered unstyled while the build and every test stayed green. Balance the
// braces here, where the defect is one line instead of a whole page.
const styleBlock = template.slice(template.indexOf('<style>'), template.indexOf('</style>'));
const cssCode = styleBlock
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
const openBraces = cssCode.split('{').length - 1;
const closeBraces = cssCode.split('}').length - 1;
if (openBraces !== closeBraces) {
  throw new Error(
    `template CSS is unbalanced: ${openBraces} "{" against ${closeBraces} "}" — a rule is missing its closing brace`,
  );
}

// The console builds no Web Audio nodes of its own for synthesis, routing or
// sequencing (#70 acceptance criterion, asserted by absence in the console's
// own code — the engine bundle below legitimately contains all of these).
const FORBIDDEN_IN_CONSOLE_CODE = [
  'createGain(',
  'createBiquadFilter(',
  'new AudioWorkletNode',
  'createDynamicsCompressor(',
  'createOscillator(',
  'createStereoPanner(',
  'createDelay(',
  'audioWorklet.addModule',
];
// The scan covers the console's code, not its tests: a test may name a
// forbidden call in an assertion or a comment without building anything.
const consoleSources = [
  ['editor-template.html', template],
  ...readdirSync(join(HERE, 'src'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => [`src/${name}`, readFileSync(join(HERE, 'src', name), 'utf8')]),
];
for (const [name, source] of consoleSources) {
  for (const forbidden of FORBIDDEN_IN_CONSOLE_CODE) {
    if (source.includes(forbidden)) {
      throw new Error(`${name} contains "${forbidden}" — drive AudioSystem, not a local graph`);
    }
  }
}

const app = await bundleConsoleApp(join(HERE, 'src/main.ts'));

// Invariant: the editor entry keeps Babylon out (only babylonBridge.ts may
// import it, and index-for-editor.ts excludes that module).
for (const forbidden of ['@babylonjs', 'babylonBridge', 'BABYLON']) {
  if (app.includes(forbidden)) {
    throw new Error(`engine bundle contains "${forbidden}" — Babylon leaked into the console`);
  }
}

const html = template
  .replace('/*__APP__*/', () => app)
  .replace('/*__WORKLET__*/', () => JSON.stringify(worklet))
  .replace('/*__REVERB__*/', () => JSON.stringify(reverb))
  .replace('/*__COMPRESSOR__*/', () => JSON.stringify(compressor));

const dest = join(HERE, 'patch-editor.html');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

if (CHECK) {
  const tracked = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  if (tracked !== html) {
    console.error(
      tracked === null
        ? 'build-editor --check: tools/patch-editor/patch-editor.html is missing'
        : 'build-editor --check: tools/patch-editor/patch-editor.html is stale — its sources changed without a rebuild',
    );
    console.error('  run: node tools/patch-editor/build-editor.mjs, then commit the page');
    process.exit(1);
  }
  console.log(
    `build-editor --check: tools/patch-editor/patch-editor.html matches its sources (${kb(Buffer.byteLength(html))})`,
  );
  process.exit(0);
}

writeFileSync(dest, html);
console.log(`built tools/patch-editor/patch-editor.html (${kb(Buffer.byteLength(html))})`);
console.log(
  `  fm: ${kb(worklet.length)}   reverb: ${kb(reverb.length)}   app+engine bundle: ${kb(app.length)}`,
);
