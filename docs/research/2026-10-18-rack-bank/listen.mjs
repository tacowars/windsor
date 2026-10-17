/* global console, process, Buffer */
/**
 * The first rack bank's listen (windsor#878 decision 3), one command from
 * the repository root:
 *
 *   node docs/research/2026-10-18-rack-bank/listen.mjs [--out ~/Desktop/rack-bank] [--only id,id]
 *
 * Each built-in rack is loaded into `listen-song.json` (128 BPM, four bars,
 * C minor) as the console adds a part from a rack, and exported through the
 * console's own audio export in a headless Chromium (`page.mjs`): stereo
 * 48 kHz 24-bit WAVs at `<out>/<id>.wav`, outside the repository and never
 * committed. It prints each file's peak and RMS, the pitches each bar plays,
 * the machine and the browser. `WINDSOR_CHROME` names the browser binary.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { launch, openPage, serve } from './browser.mjs';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const out = resolve(arg('--out', join(homedir(), 'Desktop', 'rack-bank')));
const only = arg('--only', null)?.split(',') ?? null;
if (!relative(process.cwd(), out).startsWith('..'))
  throw Error(`${out} is inside the repository: a listen is never written there`);

const { server, base } = await serve();
const browser = await launch();
try {
  const page = await openPage(browser, base);
  const ids = (await page.evaluate('rackBank.ids()')).filter((id) => !only || only.includes(id));
  console.log(`machine: ${cpus()[0].model} × ${cpus().length}, Node ${process.version}`);
  console.log(`browser: ${browser.product} headless, offline render (renderSong)`);
  mkdirSync(out, { recursive: true });
  for (const id of ids) {
    const r = await page.evaluate(`rackBank.listen(${JSON.stringify(id)})`);
    const file = join(out, `${id}.wav`);
    writeFileSync(file, Buffer.from(r.wav, 'base64'));
    console.log(
      `${file}: ${r.channels} ch, ${r.sampleRate} Hz, ${r.bitDepth}-bit, ${r.seconds.toFixed(2)} s, ` +
        `peak ${r.peakDb.toFixed(1)} dBFS, RMS ${r.rmsDb.toFixed(1)} dBFS, clipped ${r.clipped}`,
    );
    console.log(`  chain: ${r.chain.join(' → ') || 'none'}`);
    r.pitches.forEach((bar, i) => console.log(`  bar ${i + 1}: ${bar.join(' ') || '(none)'}`));
  }
  await page.close();
} finally {
  await browser.close();
  server.close();
}
