/* global document, console, Buffer, URL */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
  parts: [{ slot: 0, name: 'Long chain', preset: 'test', sequencer: { kind:'none' }, strip: { inserts: [{kind:'chorus'},{kind:'compressor'}] } }],
  master: { level:1, inserts:[{kind:'chorus'},{kind:'compressor'}] }, patches: {test:{}} };
const limit = 8;
try {
  await page.goto('file://' + root + 'tools/patch-editor/patch-editor.html');
  await page.getByRole('button', { name:'Arrangement',exact:true }).click();
  await page.locator('input[name="import-file"]').setInputFiles({ name:'long-chain.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(song)) });
  await page.getByRole('button',{name:'Enable audio',exact:true}).click();
  await page.getByRole('button',{name:'Audio on',exact:true}).waitFor();
  await page.getByRole('button',{name:'Mixer',exact:true}).click();
  const counts = [];
  for (const target of [0,'master']) {
    const strip = target === 'master' ? page.locator('.master-strip') : page.locator('.strip-row').first();
    const add = page.locator(`select[name="add-insert-${target}"]`);
    if(!await add.isEnabled()) throw Error(`${target}: Add disabled at two inserts`);
    for(let i=2;i<limit;i++) await add.selectOption('drive');
    if(!await add.isDisabled()) throw Error(`${target}: Add enabled at cap`);
    if(await strip.locator('.insert-box').count()!==limit) throw Error(`${target}: wrong card count`);
    await strip.getByRole('button',{name:'Move Chorus later in the chain',exact:true}).click();
    const names=await strip.locator('.insert-name').allTextContents();
    if(!names[0].includes('Bus compressor') || !names[1].includes('Chorus')) throw Error('Reorder failed: '+names);
    await strip.locator('.insert-box').last().getByRole('button',{name:'Remove',exact:true}).click();
    if(!await add.isEnabled()) throw Error(`${target}: Add did not re-enable after removal`);
    await add.selectOption('drive');
    counts.push({target,count:await strip.locator('.insert-box').count(),disabledAtCap:await add.isDisabled(),order:await strip.locator('.insert-name').allTextContents()});
  }
  await page.evaluate(()=>document.activeElement.blur());
  await page.keyboard.down('a');
  await page.waitForFunction(()=>[...document.querySelectorAll('.master-meter meter')].every(m=>m.value>-60));
  const meterDb=await page.locator('.master-meter meter').evaluateAll(nodes=>nodes.map(n=>n.value));
  await page.screenshot({path:out+'editor.png',fullPage:true});
  await page.keyboard.up('a');
  await page.getByRole('button',{name:'Arrangement',exact:true}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await (await download).saveAs(out+'audition-song.json');
  const saved=JSON.parse(await readFile(out+'audition-song.json','utf8'));
  if(saved.parts[0].strip.inserts.length!==limit || saved.master.inserts.length!==limit) throw Error('Export truncated chains');
  await page.locator('input[name="import-file"]').setInputFiles(out+'audition-song.json');
  await page.getByRole('button',{name:'Mixer',exact:true}).click();
  if(await page.locator('.insert-box').count()!==2*limit) throw Error('Re-import truncated chains');
  if(messages.some(m=>['warning','error'].includes(m.type))) throw Error('Console warnings/errors');
  const result={pageSha256:createHash('sha256').update(await readFile(root+'tools/patch-editor/patch-editor.html')).digest('hex'),parentCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),machine:{cpu:cpus()[0].model,os:platform()+' '+release(),browser:browser.version(),backend:'Chrome AudioWorklet and native Web Audio, headless'},limit,counts,meterDb,exportReimport:true};
  await writeFile(out+'browser.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {
  await writeFile(out+'console.json',JSON.stringify(messages,null,2)+'\n');
  await writeFile(out+'network.json',JSON.stringify(requests,null,2)+'\n');
  await browser.close();
}
