/* global console, setTimeout, Buffer, URL, window, document, AudioContext, AudioWorkletNode, process */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const out=root+'/docs/research/2026-09-23-660-compressor';
await mkdir(out,{recursive:true});
const editorOnly=process.argv.includes('--editor-only');
const capture=editorOnly?'final-editor':'browser';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1500,height:1100}});
const messages=[]; const requests=[];
page.on('console', msg=>messages.push({type:msg.type(),text:msg.text()}));
page.on('pageerror', err=>messages.push({type:'error',text:err.message}));
page.on('requestfinished', req=>requests.push({url:req.url(),status:'finished'}));
page.on('requestfailed', req=>requests.push({url:req.url(),status:'failed',error:req.failure()}));
await page.addInitScript(()=>{
  window.__660nodes=[]; window.__660contexts=[];
  const Node=window.AudioWorkletNode;
  window.AudioWorkletNode=class extends Node {constructor(...args){super(...args);window.__660nodes.push({name:args[1],node:this});}};
  const Context=window.AudioContext;
  window.AudioContext=class extends Context {constructor(...args){super(...args);window.__660contexts.push(this);}};
});
const spec={kind:'compressor',threshold:-30,makeup:0,attack:10,ratio:4,release:0,highpass:0,range:60,mix:1,enabled:true};
const song={version:2,seed:0,bpm:120,key:{root:48,scale:'minor'},parts:[{slot:0,name:'Compressor audition',preset:'test',sequencer:{kind:'none'},strip:{inserts:[spec]}}],patches:{test:{}}};
try {
  await page.goto('file://'+root+'/tools/patch-editor/patch-editor.html');
  await page.getByRole('button',{name:'Arrangement',exact:true}).click();
  await page.locator('input[name="import-file"]').setInputFiles({name:'660-audition.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(song))});
  await page.getByRole('button',{name:'Enable audio',exact:true}).click();
  await page.getByRole('button',{name:'Audio on',exact:true}).waitFor();
  await page.getByRole('button',{name:'Mixer',exact:true}).click();
  await page.getByLabel('Ratio',{exact:true}).selectOption('10');
  await page.getByRole('combobox',{name:'Attack',exact:true}).selectOption('0.3');
  await page.getByRole('combobox',{name:'Release',exact:true}).selectOption('0.4');
  await page.evaluate(()=>document.activeElement.blur());
  await page.keyboard.down('a');
  await page.waitForFunction(()=>Number(document.querySelector('.compressor-meter meter')?.value)>0.5,{},{timeout:10000});
  const active=await page.evaluate(()=>({
    value:document.querySelector('.compressor-meter meter').value,
    label:document.querySelector('.compressor-meter .readout').textContent,
    params:Object.fromEntries([...window.__660nodes.find(n=>n.name==='a204-compressor').node.parameters].map(([key,p])=>[key,p.value])),
    context:window.__660contexts.at(-1).state,
    sampleRate:window.__660contexts.at(-1).sampleRate,
  }));
  await page.screenshot({path:out+'/editor.png',fullPage:true});
  await page.keyboard.up('a');
  await page.getByLabel('Compression',{exact:true}).uncheck();
  await page.waitForFunction(()=>document.querySelector('.compressor-meter meter').value===0);
  await page.getByRole('button',{name:'Arrangement',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export',exact:true}).click();
  const download=await downloadPromise;
  await download.saveAs(out+'/audition-song.json');
  const exported=JSON.parse(await readFile(out+'/audition-song.json','utf8'));
  const saved=exported.parts[0].strip.inserts[0];
  if(saved.ratio!==10 || saved.attack!==0.3 || saved.release!==0.4 || saved.enabled!==false) throw Error('Live/export mismatch');
  const measurements=[];
  // Real AudioWorklet rendering on this development browser. Meter off, fixed
  // independent stereo paths; each compressor sees the same full-level tone.
  for(const count of (editorOnly?[]:[0,1,8,16])) {
    const result=await page.evaluate(async(count)=>{
      const context=new AudioContext({latencyHint:'interactive'});
      await context.audioWorklet.addModule('data:application/javascript;charset=utf-8,'+encodeURIComponent(window.__A204_DSP__.compressor));
      const oscillator=context.createOscillator(); oscillator.frequency.value=220;
      const output=context.createGain(); output.gain.value=0; output.connect(context.destination);
      const reports=[]; const nodes=[];
      for(let i=0;i<count;i++) {
        const node=new AudioWorkletNode(context,'a204-compressor',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],parameterData:{threshold:-24,ratio:4,attack:10,release:0}});
        node.port.onmessage=({data})=>{if(data.type==='load')reports.push({id:i,...data});};
        oscillator.connect(node); node.connect(output); nodes.push(node);
      }
      if(!count)oscillator.connect(output);
      oscillator.start(); await context.resume();
      await new Promise(resolve=>setTimeout(resolve,500));
      for(const node of nodes)node.port.postMessage({type:'reportLoad',quanta:Math.round(context.sampleRate/128)});
      await new Promise(resolve=>setTimeout(resolve,3500));
      const playback=context.playbackStats?{underrunEvents:context.playbackStats.underrunEvents,totalDuration:context.playbackStats.totalDuration}:null;
      const sampleRate=context.sampleRate;
      oscillator.stop(); for(const node of nodes){node.port.postMessage({type:'stop'});node.disconnect();node.port.close();}
      await context.close(); return {count,sampleRate,playback,reports};
    },count);
    measurements.push(result);
  }
  const sourceSha256=createHash('sha256').update(await readFile(root+'/tools/patch-editor/patch-editor.html')).digest('hex');
  const result={sourceSha256,machine:{cpu:cpus()[0].model,os:platform()+' '+release(),browser:browser.version(),backend:'Chrome AudioWorklet, headless',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()},active,exported:saved,measurements};
  await writeFile(out+'/'+capture+'.json',JSON.stringify(result,null,2)+'\n');
  const errors=messages.filter(m=>['error','warning'].includes(m.type));
  if(errors.length)throw Error('Console errors/warnings: '+JSON.stringify(errors));
  console.log(JSON.stringify({active,exported:saved,cases:measurements.map(m=>({count:m.count,reports:m.reports.length,playback:m.playback})),consoleErrors:errors.length}));
} finally {
  await writeFile(out+'/'+capture+'-console.json',JSON.stringify(messages,null,2)+'\n');
  await writeFile(out+'/'+capture+'-network.json',JSON.stringify(requests,null,2)+'\n');
  await browser.close();
}
