/* global process, console, URL */
/** Do the warm-up's scratch arguments have Chrome's maps? (windsor#837), from the repo root:
 *   node docs/research/2026-10-16-worklet-warm-up/argumentMaps.mjs
 * Bundles `argumentMapsWorklet.mjs` over the shipped `worklet/warmUp.ts`, serves it, and runs
 * it in a headless Chrome started with `--js-flags=--allow-natives-syntax` (a wrapper script in
 * a temporary folder, removed after), then prints what the worklet posted. Chrome is
 * `WINDSOR_CHROME`, by default the installed Google Chrome on macOS.
 */
import { build } from 'esbuild';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch, openPage } from '../2026-10-13-performance-assessment/cdp.mjs';

const CHROME =
  process.env.WINDSOR_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const folder = new URL('./', import.meta.url);

const worklet = await build({
  entryPoints: [new URL('argumentMapsWorklet.mjs', folder).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  target: 'esnext',
});
const page = `<!doctype html><script type="module">
const ctx = new AudioContext();
await ctx.audioWorklet.addModule('/worklet.js');
const source = new ConstantSourceNode(ctx);
source.start();
const node = new AudioWorkletNode(ctx, 'argument-maps', {
  numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
});
source.connect(node, 0, 0);
node.connect(ctx.destination);
window.result = new Promise((resolve) => (node.port.onmessage = (event) => resolve(event.data)));
</script>`;
const served = { '/': ['text/html', page], '/worklet.js': ['text/javascript', worklet.outputFiles[0].text] };
const server = createServer((req, res) => {
  const [type, text] = served[req.url] ?? ['text/plain', ''];
  res.setHeader('content-type', type);
  res.end(text);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const dir = mkdtempSync(join(tmpdir(), 'windsor-837-maps-'));
const wrapper = join(dir, 'chrome.sh');
writeFileSync(wrapper, `#!/bin/sh\nexec "${CHROME}" --js-flags=--allow-natives-syntax "$@"\n`);
chmodSync(wrapper, 0o755);
const browser = await launch(wrapper, dir);
try {
  const tab = await openPage(browser, `http://127.0.0.1:${server.address().port}/`);
  await sleep(1500);
  console.log(JSON.stringify(await tab.evaluate('window.result'), null, 2));
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
