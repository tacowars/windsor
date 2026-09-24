/* global document, window, console, Buffer, URL, OfflineAudioContext, AudioWorkletNode */
// Functional dev-machine evidence; the listening verdict remains Pat's.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cpus, platform, release } from 'node:os';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = fileURLToPath(new URL('./', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const messages = [], requests = [];
page.on('console', m => messages.push({ type: m.type(), text: m.text() }));
page.on('pageerror', e => messages.push({ type: 'error', text: e.message }));
page.on('requestfinished', r => requests.push({ url: r.url(), status: 'finished' }));
page.on('requestfailed', r => requests.push({ url: r.url(), status: 'failed', error: r.failure() }));
const song = { version: 2, seed: 0, bpm: 120, key: { root: 48, scale: 'minor' },
  parts: [{ slot: 0, name: 'Phaser audition', preset: 'test', sequencer: { kind: 'none' }, strip: { inserts: [{ kind: 'phaser', mix: 0.23 }] } }],
  master: { level: 1, inserts: [{ kind: 'phaser', mix: 0.15 }] }, patches: { test: {} } };
try {
  await page.goto('file://' + root + 'tools/patch-editor/patch-editor.html');
  await page.getByRole('button', { name: 'Arrangement', exact: true }).click();
  await page.locator('input[name="import-file"]').setInputFiles({ name: 'phaser.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(song)) });
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.getByRole('button', { name: 'Audio on', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mixer', exact: true }).click();
  const track = page.locator('.strip-row').first(), master = page.locator('.master-strip');
  await track.getByRole('combobox', { name: 'Phaser preset' }).selectOption('acid');
  await master.getByRole('combobox', { name: 'Phaser preset' }).selectOption('space');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.down('a');
  await page.waitForFunction(() => [...document.querySelectorAll('.master-meter meter')].every(m => m.value > -60));
  await track.getByRole('combobox', { name: 'Phaser preset' }).selectOption('color');
  // Change Depth through a real pointer drag; it must update both audio and the saved document.
  const knob = track.getByRole('slider', { name: 'Depth (oct)', exact: true });
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30); await page.mouse.up();
  if (await track.getByRole('combobox', { name: 'Phaser preset' }).inputValue() !== '') throw Error('Edited preset did not become Custom');
  const meterDb = await page.locator('.master-meter meter').evaluateAll(nodes => nodes.map(n => n.value));
  await page.keyboard.up('a');
  await page.screenshot({ path: out + 'editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Arrangement', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await (await download).saveAs(out + 'audition-song.json');
  const saved = JSON.parse(await readFile(out + 'audition-song.json', 'utf8'));
  const fx = saved.parts[0].strip.inserts[0];
  if (fx.center !== 420 || fx.mix !== 0.23 || fx.depth <= 2.4 || saved.master.inserts[0].stereo !== 120) throw Error('Saved settings did not follow controls');
  await page.locator('input[name="import-file"]').setInputFiles(out + 'audition-song.json');
  await page.getByRole('button', { name: 'Mixer', exact: true }).click();
  // ARIA readouts are rounded by the shared knob. The exported document is the precision contract.
  if (Math.abs(Number(await track.getByRole('slider', { name: 'Depth (oct)', exact: true }).getAttribute('aria-valuenow')) - fx.depth) > 0.001) throw Error('Reimport lost depth');
  await page.getByRole('button', { name: 'Arrangement', exact: true }).click();
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const stream = await (await again).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  if (JSON.stringify(JSON.parse(Buffer.concat(chunks).toString())) !== JSON.stringify(saved)) throw Error('Document changed on reimport');
  const offline = await page.evaluate(async () => {
    const results = [];
    for (const stereo of [0, 120]) {
      const context = new OfflineAudioContext(2, 48000, 48000);
      // Match the editor's file:// fallback; this Chrome rejects blob:null for offline worklets.
      const url = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(window.__A204_DSP__.phaser);
      await context.audioWorklet.addModule(url);
      const fx = new AudioWorkletNode(context, 'phaser', { outputChannelCount: [2], parameterData: { mix: 0.5, stereo, feedback: 0.5 } });
      const buffer = context.createBuffer(1, 48000, 48000); buffer.getChannelData(0)[0] = 0.8;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(fx); fx.connect(context.destination); source.start();
      const rendered = await context.startRendering();
      const samples = rendered.getChannelData(0);
      let energy = 0, late = 0, peak = 0;
      for (let i = 0; i < samples.length; i++) { energy += samples[i] ** 2; peak = Math.max(peak, Math.abs(samples[i])); if (i > 48000 * 0.34) late += samples[i] ** 2; }
      if (!(energy > 1e-6) || !Number.isFinite(peak)) throw Error('Browser wet render failed');
      results.push({ stereo, energy, late, peak });
    }
    return results;
  });
  if (messages.some(m => ['warning', 'error'].includes(m.type))) throw Error('Console warning/error');
  const result = { pageSha256: createHash('sha256').update(await readFile(root + 'tools/patch-editor/patch-editor.html')).digest('hex'), machine: { cpu: cpus()[0].model, os: platform() + ' ' + release(), browser: browser.version(), backend: 'headless Chrome AudioWorklet / OfflineAudioContext; no graphics rendering' }, meterDb, savedTrackEffect: fx, savedMasterEffect: saved.master.inserts[0], exportReimport: true, offline };
  await writeFile(out + 'browser.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await writeFile(out + 'console.json', JSON.stringify(messages, null, 2) + '\n');
  await writeFile(out + 'network.json', JSON.stringify(requests, null, 2) + '\n');
  await browser.close();
}
