/* global console, Buffer */
/**
 * Generates the standalone arrangement console (#70).
 *
 * The console must run as one file with no imports and no dev server — from
 * file:// or any static server — so this inlines into `editor-template.html`:
 *
 *   - `worklet/fm-processor.js` and `worklet/reverb-processor.js` verbatim, as
 *     strings the page turns into blob URLs for `FmEngine.init()`
 *   - the console app (`src/main.ts`), bundled by esbuild together with the
 *     real engine via `packages/client/src/audio/index-for-editor.ts`
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
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(HERE, '../../packages/client/src/audio');

const worklet = readFileSync(join(AUDIO, 'worklet/fm-processor.js'), 'utf8');
const reverb = readFileSync(join(AUDIO, 'worklet/reverb-processor.js'), 'utf8');
const template = readFileSync(join(HERE, 'editor-template.html'), 'utf8');

for (const marker of ['/*__WORKLET__*/', '/*__REVERB__*/', '/*__APP__*/']) {
  if (!template.includes(marker)) throw new Error(`template is missing ${marker}`);
}

// The console is a complete standalone document (decision record
// `2026-08-31-arrangement-console-and-runtime-arrangements`, "local tool"):
// it is no longer published as an Artifact, so it carries its own skeleton.
if (!/^<!doctype html>/i.test(template.trim())) {
  throw new Error('template must be a complete document starting with <!doctype html>');
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
const consoleSources = [
  ['editor-template.html', template],
  ...readdirSync(join(HERE, 'src'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => [`src/${name}`, readFileSync(join(HERE, 'src', name), 'utf8')]),
];
for (const [name, source] of consoleSources) {
  for (const forbidden of FORBIDDEN_IN_CONSOLE_CODE) {
    if (source.includes(forbidden)) {
      throw new Error(`${name} contains "${forbidden}" — drive AudioSystem, not a local graph`);
    }
  }
}

const bundle = await build({
  entryPoints: [join(HERE, 'src/main.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
  // `workletMessages.ts` builds its default URLs from `import.meta.url`,
  // which an IIFE lacks; the host always passes blob-URL overrides, so the
  // defaults only need to *construct* without throwing.
  define: { 'import.meta.url': 'self.location.href' },
});

const [output] = bundle.outputFiles;
if (!output) throw new Error('esbuild produced no output');

// Invariant: the editor entry keeps Babylon out (only babylonBridge.ts may
// import it, and index-for-editor.ts excludes that module).
for (const forbidden of ['@babylonjs', 'babylonBridge', 'BABYLON']) {
  if (output.text.includes(forbidden)) {
    throw new Error(`engine bundle contains "${forbidden}" — Babylon leaked into the console`);
  }
}

const html = template
  .replace('/*__APP__*/', () => output.text)
  .replace('/*__WORKLET__*/', () => JSON.stringify(worklet))
  .replace('/*__REVERB__*/', () => JSON.stringify(reverb));

const dest = join(HERE, 'patch-editor.html');
writeFileSync(dest, html);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`built tools/patch-editor/patch-editor.html (${kb(Buffer.byteLength(html))})`);
console.log(
  `  fm: ${kb(worklet.length)}   reverb: ${kb(reverb.length)}   app+engine bundle: ${kb(output.text.length)}`,
);
