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
const page = await browser.newPage({ viewport: { width: 1500, height: 1400 } });
page.setDefaultTimeout(12000);
const messages = [], requests = [];
page.on('console', m => messages.push({ type: m.type(), text: m.text() }));
page.on('pageerror', e => messages.push({ type: 'error', text: e.message }));
page.on('requestfinished', r => requests.push({ url: r.url(), status: 'finished' }));
page.on('requestfailed', r => requests.push({ url: r.url(), status: 'failed', error: r.failure() }));
await page.addInitScript(() => {
  window.__sidechainNodes = [];
  const Base = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends Base {
    constructor(...args) {
      super(...args);
      const record = { name: args[1], node: this, stopped: false };
      window.__sidechainNodes.push(record);
      const post = this.port.postMessage.bind(this.port);
      this.port.postMessage = data => { if (data.type === 'stop') record.stopped = true; post(data); };
    }
  };
});
const song = { version: 2, seed: 0, bpm: 120, key: { root: 48, scale: 'minor' }, parts: [
  { slot: 0, name: 'Trigger', preset: 'test', sequencer: { kind: 'none' }, strip: { output: 'sidechain', sends: { room: 0.7, echo: 0.7 } } },
  { slot: 1, name: 'Program', preset: 'test', sequencer: { kind: 'none' }, strip: { sends: { room: 0, echo: 0 } } },
], patches: { test: {} } };
const note = async (part, on) => page.evaluate(({part,on}) => {
  const node = window.__sidechainNodes.filter(n => n.name === 'fm-part' && !n.stopped)[part].node;
  node.port.postMessage(on ? { type:'noteOn', id:100, note: part ? 60 : 48, velocity:1, frame:Math.round(node.context.currentTime * node.context.sampleRate) } : {type:'allNotesOff'});
}, {part,on});
const snapshot = () => page.evaluate(() => ({
  masterDb: [...document.querySelectorAll('.master-meter meter')].map(m => m.value),
  reductionDb: [...document.querySelectorAll('.compressor-meter meter')].map(m => m.value),
  external: window.__sidechainNodes.filter(n => n.name === 'a204-compressor' && !n.stopped).map(n => n.node.parameters.get('external').value),
}));
try {
  await page.goto('file://' + root + 'tools/patch-editor/patch-editor.html');
  await page.getByRole('button', { name: 'Arrangement', exact: true }).click();
  await page.locator('input[name="import-file"]').setInputFiles({ name: 'sidechain.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(song)) });
  await page.getByRole('button', { name: 'Enable audio', exact: true }).click();
  await page.getByRole('button', { name: 'Audio on', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mixer', exact: true }).click();
  await page.locator('select[name="add-insert-1"]').selectOption('compressor');
  await page.locator('select[name="add-insert-master"]').selectOption('compressor');
  for (const target of ['1','master']) {
    await page.getByRole('combobox', { name: `Sidechain ${target} insert 1`, exact: true }).selectOption('0');
  }
  for (const card of [page.locator('.strip-row').nth(1), page.locator('.master-strip')]) {
    await card.getByRole('combobox', { name: 'Ratio', exact: true }).selectOption('10');
    await card.getByRole('combobox', { name: 'Release', exact: true }).selectOption('0.1');
    const threshold = card.getByRole('slider', { name:'Threshold', exact:true });
    for (let i=0;i<20;i++) await threshold.press('ArrowDown');
  }
  await note(0, true);
  await page.waitForFunction(() => [...document.querySelectorAll('.compressor-meter meter')].every(m => m.value > 3));
  await page.waitForFunction(() => [...document.querySelectorAll('.master-meter meter')].every(m => m.value === -60));
  const silentTriggerOnly = await snapshot();
  await note(1, true);
  await page.waitForFunction(() => [...document.querySelectorAll('.master-meter meter')].every(m => m.value > -60));
  await page.waitForTimeout(300);
  const silentTriggerDucking = await snapshot();
  const sourceLevel = page.locator('.strip-row').nth(0).getByRole('slider', {name:'Level',exact:true});
  for(let i=0;i<100;i++) await sourceLevel.press('ArrowDown');
  await page.waitForFunction(() => [...document.querySelectorAll('.compressor-meter meter')].every(m => m.value < 0.5));
  const triggerLevelZero = await snapshot();
  await sourceLevel.dblclick();
  await page.waitForFunction(() => [...document.querySelectorAll('.compressor-meter meter')].every(m => m.value > 3));
  await page.getByRole('combobox', { name:'Output slot 0',exact:true }).selectOption('master');
  await page.waitForTimeout(400);
  const audibleSourceDucking = await snapshot();
  await page.getByRole('combobox', { name:'Output slot 0',exact:true }).selectOption('sidechain');
  await page.screenshot({path:out+'editor.png',fullPage:true});
  await note(0,false); await note(1,false);
  await page.getByRole('button', { name:'Arrangement',exact:true }).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button', { name:'Export',exact:true }).click();
  await (await downloadPromise).saveAs(out+'audition-song.json');
  const saved=JSON.parse(await readFile(out+'audition-song.json','utf8'));
  if(saved.parts[0].strip.output!=='sidechain' || saved.parts[1].strip.inserts[0].sidechain.track!==0 || saved.master.inserts[0].sidechain.track!==0) throw Error('Routing lost on export');
  await page.locator('input[name="import-file"]').setInputFiles(out+'audition-song.json');
  await page.getByRole('button',{name:'Mixer',exact:true}).click();
  if(await page.getByRole('combobox',{name:'Sidechain master insert 1',exact:true}).inputValue()!=='0') throw Error('Master source lost on re-import');
  if(await page.getByRole('combobox',{name:'Sidechain 1 insert 1',exact:true}).inputValue()!=='0') throw Error('Track source lost on re-import');
  if(await page.getByRole('combobox',{name:'Output slot 0',exact:true}).inputValue()!=='sidechain') throw Error('Output lost on re-import');
  if(messages.some(m => ['warning','error'].includes(m.type))) throw Error('Console warnings/errors');
  const result={pageSha256:createHash('sha256').update(await readFile(root+'tools/patch-editor/patch-editor.html')).digest('hex'),parentCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),machine:{cpu:cpus()[0].model,os:platform()+' '+release(),browser:browser.version(),backend:'Chrome AudioWorklet, headless'},silentTriggerOnly,silentTriggerDucking,triggerLevelZero,audibleSourceDucking,exportReimport:true};
  await writeFile(out+'browser.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {
  await writeFile(out+'console.json',JSON.stringify(messages,null,2)+'\n');
  await writeFile(out+'network.json',JSON.stringify(requests,null,2)+'\n');
  await browser.close();
}
