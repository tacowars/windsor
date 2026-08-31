/* global process, fetch, WebSocket, setTimeout, console */
// Throwaway evidence driver for ticket #69 (kept with the record, not part of
// the build). Attaches CDP to an EXISTING tab (matched by URL substring) and
// walks the audible flow the refinement decided: a synthesized user gesture
// (keydown, which Chrome counts as user activation) unlocks the AudioContext
// and starts the music; `__a204.audio.apply({bpm:90})` retunes the transport
// live; an unknown key is ignored and reported; `M` mutes and unmutes. Every
// step's `__a204.audio.readout()` and every console message seen during the
// drive are dumped as JSON.
//
//   node cdp-drive.mjs <cdpPort> <urlSubstring> [--no-gesture]
const [port, needle, flag] = process.argv.slice(2);
const gesture = flag !== '--no-gesture';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = targets.filter((t) => t.type === 'page');
const target = pages.find((t) => t.url === needle) ?? pages.find((t) => t.url.includes(needle));
if (!target) throw new Error(`no page target matching ${needle}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', () => rej(new Error('CDP connect failed')));
});

let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((r) => {
    pending.set(++id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });

const consoleSeen = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleSeen.push({
      type: m.params.type,
      text: (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '),
    });
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleSeen.push({ type: 'exception', text: m.params.exceptionDetails?.text ?? '?' });
  }
});

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value ?? r;
};

const key = async (code, keyChar, vk) => {
  const base = { code, key: keyChar, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
};

await send('Runtime.enable');
await sleep(500); // let the replayed backlog land before the drive starts
const backlog = consoleSeen.length;

const steps = {};
steps.readoutBeforeGesture = await evaluate('window.__a204.audio.readout()');

if (gesture) {
  // KeyP: bound to nothing in the client; any keydown is the unlock gesture.
  await key('KeyP', 'p', 80);
  await sleep(1500);
}
steps.readoutAfterGesture = await evaluate('window.__a204.audio.readout()');

if (gesture) {
  steps.applyBpm90 = await evaluate('window.__a204.audio.apply({ bpm: 90 })');
  steps.readoutAfterApply = await evaluate('window.__a204.audio.readout()');
  steps.applyUnknownKey = await evaluate('window.__a204.audio.apply({ bogus: 1 })');
  await sleep(1000);

  await key('KeyM', 'm', 77);
  await sleep(800);
  steps.readoutMuted = await evaluate('window.__a204.audio.readout()');
  await key('KeyM', 'm', 77);
  await sleep(800);
  steps.readoutUnmuted = await evaluate('window.__a204.audio.readout()');
  await sleep(1200);
  steps.readoutFinal = await evaluate('window.__a204.audio.readout()');
}

ws.close();
console.log(
  JSON.stringify(
    {
      url: target.url,
      gesture,
      steps,
      consoleDuringDrive: consoleSeen.slice(backlog),
      consoleReplayedBacklog: consoleSeen.slice(0, backlog),
    },
    null,
    2,
  ),
);
