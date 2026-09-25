/* global URL, window, Buffer, OfflineAudioContext, btoa, AudioWorkletNode, console */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) errors.push(m.text());
  });
  await page.addInitScript(() => {
    window.delayNodes = [];
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(ctx, name, opts) {
        super(ctx, name, opts);
        if (name === 'dub-delay') window.delayNodes.push(this);
      }
    };
  });
  await page.goto('file://' + root + '/tools/patch-editor/patch-editor.html');
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.getByRole('button', { name: 'Mixer', exact: true }).click();
  await page.getByLabel('Add an insert to slot 0', { exact: true }).selectOption('delay');
  const track = page.locator('.delay-card').first();
  await track.getByLabel('Starting point', { exact: true }).selectOption('dub');
  await track.getByRole('slider', { name: 'Feedback', exact: true }).press('ArrowDown');
  const edited = Number(
    await track
      .getByRole('slider', { name: 'Feedback', exact: true })
      .getAttribute('aria-valuenow'),
  );
  await track.getByLabel('Routing', { exact: true }).selectOption('mid-side');
  assert.equal(
    Number(
      await track
        .getByRole('slider', { name: 'Feedback', exact: true })
        .getAttribute('aria-valuenow'),
    ),
    edited,
  );
  await track.getByLabel('Mid clock', { exact: true }).selectOption('free');
  await track.getByRole('slider', { name: 'Mid time (ms)', exact: true }).press('ArrowUp');
  await track.getByLabel('Side division', { exact: true }).selectOption('1/8T');
  await page.getByLabel('Add an insert to Master', { exact: true }).selectOption('delay');
  await page.getByRole('button', { name: 'Arrangement', exact: true }).click();
  await page.getByRole('slider', { name: 'BPM', exact: true }).press('ArrowUp');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const doc = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  assert.equal(doc.parts[0].strip.inserts[0].mode, 'mid-side');
  assert.equal(doc.parts[0].strip.inserts[0].leftSync, false);
  assert.equal(doc.parts[0].strip.inserts[0].rightDivision, '1/8T');
  assert.equal(doc.master.inserts[0].kind, 'delay');
  assert.ok(Math.abs(doc.parts[0].strip.inserts[0].feedback - edited) < 0.001);
  const params = await page.evaluate(() =>
    window.delayNodes.map((n) =>
      Object.fromEntries([...n.parameters].map(([k, v]) => [k, v.value])),
    ),
  );
  assert.ok(Math.abs(params.at(-1).rightMs - 60000 / doc.bpm) < 0.01);
  await page
    .getByLabel('Import a document', { exact: true })
    .setInputFiles({
      name: 'delay-test.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(doc)),
    });
  await page.getByRole('button', { name: 'Mixer', exact: true }).click();
  await page.locator('.delay-card').first().getByLabel('Mid clock', { exact: true }).waitFor();
  assert.equal(
    await page.locator('.delay-card').first().getByLabel('Mid clock', { exact: true }).inputValue(),
    'free',
  );
  const offline = await page.evaluate(async () => {
    const results = [];
    for (const mode of [0, 1, 2]) {
      const ctx = new OfflineAudioContext(2, 48000, 48000);
      const url =
        'data:text/javascript;base64,' +
        btoa(unescape(encodeURIComponent(window.__A204_DSP__.delay)));
      await ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(ctx, 'dub-delay', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        parameterData: { mode, leftMs: 100, rightMs: 200, feedback: 0.7, mix: 1 },
      });
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(2, 48000, 48000);
      source.buffer.getChannelData(0)[0] = 0.5;
      source.buffer.getChannelData(1)[0] = 0.5;
      source.connect(node).connect(ctx.destination);
      source.start();
      const out = await ctx.startRendering();
      let peak = 0,
        energy = 0,
        first = -1;
      for (let ch = 0; ch < 2; ch++)
        for (let i = 0; i < out.length; i++) {
          const x = out.getChannelData(ch)[i];
          if (x !== 0 && first < 0) first = i;
          peak = Math.max(peak, Math.abs(x));
          energy += x * x;
        }
      results.push({ mode, peak, energy, first });
    }
    return results;
  });
  assert.ok(offline.every((r) => Number.isFinite(r.peak) && r.energy > 0 && r.first === 4800));
  assert.deepEqual(errors, []);
  await writeFile(
    new URL('./browser.json', import.meta.url),
    JSON.stringify(
      {
        browser: browser.version(),
        bpm: doc.bpm,
        track: doc.parts[0].strip.inserts[0],
        master: doc.master,
        offline,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      browser: browser.version(),
      offline,
      errors,
      controls: 'track/master live edits, BPM, export/import passed',
    }),
  );
} finally {
  await browser.close();
}
