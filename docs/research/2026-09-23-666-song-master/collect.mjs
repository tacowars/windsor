/* global window, document, console, Buffer, URL */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release } from 'node:os';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = fileURLToPath(new URL('./', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
const messages = [], requests = [];
page.on('console', m => messages.push({ type: m.type(), text: m.text() }));
page.on('pageerror', e => messages.push({ type: 'error', text: e.message }));
page.on('requestfinished', r => requests.push({ url: r.url(), status: 'finished' }));
page.on('requestfailed', r => requests.push({ url: r.url(), status: 'failed', error: r.failure() }));
await page.addInitScript(() => {
  window.__masterNodes = [];
  const Base = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends Base {
    constructor(...args) {
      super(...args);
      const record = { name: args[1], node: this, stopped: false, reports: [] };
      window.__masterNodes.push(record);
      const post = this.port.postMessage.bind(this.port);
      this.port.postMessage = data => { if (data.type === 'stop') record.stopped = true; post(data); };
      this.port.addEventListener('message', ({ data }) => { if (data.type === 'peaks') record.reports.push(data); });
      this.port.start();
    }
  };
});
const song = { version: 2, seed: 0, bpm: 120, key: { root: 48, scale: 'minor' }, parts: [{ slot: 0, name: 'Master audition', preset: 'test', sequencer: { kind: 'none' }, strip: { sends: { room: 0.3, echo: 0.2 } } }], patches: { test: {} } };
try {
  await page.goto('file://' + root + '/tools/patch-editor/patch-editor.html');
  await page.getByRole('button', { name: 'Arrangement', exact: true }).click();
  await page.locator('input[name="import-file"]').setInputFiles({ name: 'master.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(song)) });
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.getByRole('button', { name: 'Audio on', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mixer', exact: true }).click();
  const master = page.locator('.master-strip');
  await master.locator('select[name="add-insert-master"]').selectOption('compressor');
  await master.getByRole('combobox', { name: 'Ratio', exact: true }).selectOption('10');
  const threshold = master.getByRole('slider', { name: 'Threshold', exact: true });
  for (let i = 0; i < 40; i++) await threshold.press('ArrowDown');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.down('a');
  await page.waitForFunction(() => [...document.querySelectorAll('.master-meter meter')].every(m => m.value > -60));
  await page.waitForFunction(() => document.querySelector('.master-strip .compressor-meter meter').value > 0.5);
  const active = await page.evaluate(() => ({ levels: [...document.querySelectorAll('.master-meter meter')].map(m => m.value), reduction: document.querySelector('.master-strip .compressor-meter meter').value, meter: window.__masterNodes.findLast(n => n.name === 'a204-peak-meter').reports.at(-1), compressor: Object.fromEntries([...window.__masterNodes.find(n => n.name === 'a204-compressor').node.parameters].map(([key, param]) => [key, param.value])) }));
  await page.screenshot({ path: out + 'editor.png', fullPage: true });
  const level = master.getByRole('slider', { name: 'Level', exact: true });
  for (let i = 0; i < 100; i++) await level.press('ArrowDown');
  await page.waitForFunction(() => [...document.querySelectorAll('.master-meter meter')].every(m => m.value === -60));
  await level.dblclick();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.up('a');
  await page.getByRole('button', { name: 'Arrangement', exact: true }).click();
  await page.waitForFunction(() => window.__masterNodes.filter(n => n.name === 'a204-peak-meter').every(n => n.stopped));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await (await downloadPromise).saveAs(out + 'audition-song.json');
  const saved = JSON.parse(await readFile(out + 'audition-song.json', 'utf8'));
  if (saved.master.level !== 1 || saved.master.inserts[0].ratio !== 10) throw Error('Master edits lost on export');
  await page.getByRole('button', { name: 'Mixer', exact: true }).click();
  await page.waitForFunction(() => window.__masterNodes.filter(n => n.name === 'a204-peak-meter' && !n.stopped && n.reports.length > 0).length === 1);
  const nodeCounts = await page.evaluate(() => window.__masterNodes.map(({ name, stopped, reports }) => ({ name, stopped, reports: reports.length })));
  if (messages.some(m => ['error', 'warning'].includes(m.type))) throw Error('Console warnings/errors');
  const result = { pageSha256: createHash('sha256').update(await readFile(root + '/tools/patch-editor/patch-editor.html')).digest('hex'), parentCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), machine: { cpu: cpus()[0].model, os: platform() + ' ' + release(), browser: browser.version(), backend: 'Chrome AudioWorklet, headless' }, active, saved: saved.master, nodeCounts, masterLevelZeroSilencesMeter: true, hiddenMeterStopped: true };
  await writeFile(out + 'browser.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  await writeFile(out + 'console.json', JSON.stringify(messages, null, 2) + '\n');
  await writeFile(out + 'network.json', JSON.stringify(requests, null, 2) + '\n');
  await browser.close();
}
