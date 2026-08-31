/* global process, fetch, WebSocket, setTimeout, console */
// Companion to cdp-collect.mjs: attach to an EXISTING tab (matched by a URL
// substring) and dump the console messages Chrome replays on Runtime.enable,
// so the listing covers everything since load -- including whatever the bridge
// commands (a204-motor, take-screenshot) logged after the collector's window.
//
//   node cdp-console.mjs <cdpPort> <urlSubstring>
const [port, needle] = process.argv.slice(2);
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

const messages = [];
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    messages.push({
      type: m.params.type,
      text: (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '),
    });
  } else if (m.method === 'Runtime.exceptionThrown') {
    messages.push({ type: 'exception', text: m.params.exceptionDetails?.text ?? '?' });
  } else if (m.method === 'Log.entryAdded') {
    logs.push({ level: m.params.entry.level, source: m.params.entry.source, text: m.params.entry.text });
  }
});

await send('Runtime.enable');
await send('Log.enable');
await sleep(1500);
ws.close();

const bad = (t) => ['error', 'warning', 'warn', 'assert', 'exception'].includes(t);
console.log(
  JSON.stringify(
    {
      url: target.url,
      console: messages,
      consoleErrorsOrWarnings: messages.filter((c) => bad(c.type)),
      logEntries: logs,
      logErrorsOrWarnings: logs.filter((l) => bad(l.level)),
    },
    null,
    2,
  ),
);
