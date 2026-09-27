/* global process, fetch, WebSocket, setTimeout, console */
// Throwaway evidence collector for ticket #57 (kept with the record, not
// part of the build). Attaches CDP to an already-launched Chrome, opens a
// NEW tab for the URL (so each backend's listing is its own, unlike #53's
// single-session variant) and records every console message, every Log
// entry and every network response for `seconds` — the same two listings
// the chrome-devtools MCP's list_console_messages / list_network_requests
// produce. Used because the MCP's browser profile was held by a parallel
// session; see the record's README.
//
//   node cdp-collect.mjs <cdpPort> <url> <seconds>
const [port, url, secs] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', () => rej(new Error('CDP connect failed')));
});

let id = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) =>
  new Promise((r) => {
    pending.set(++id, r);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const console_ = [];
const logs = [];
const requests = new Map();
let sid;

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
    return;
  }
  if (m.sessionId !== sid) return;
  if (m.method === 'Runtime.consoleAPICalled') {
    console_.push({
      type: m.params.type,
      text: (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '),
    });
  } else if (m.method === 'Runtime.exceptionThrown') {
    console_.push({ type: 'exception', text: m.params.exceptionDetails?.text ?? '?' });
  } else if (m.method === 'Log.entryAdded') {
    logs.push({ level: m.params.entry.level, source: m.params.entry.source, text: m.params.entry.text });
  } else if (m.method === 'Network.requestWillBeSent') {
    requests.set(m.params.requestId, { url: m.params.request.url, status: null });
  } else if (m.method === 'Network.responseReceived') {
    const r = requests.get(m.params.requestId);
    if (r) r.status = m.params.response.status;
  } else if (m.method === 'Network.loadingFailed') {
    const r = requests.get(m.params.requestId);
    if (r) r.status = `FAILED: ${m.params.errorText}`;
  }
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
({ sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true }));
await send('Runtime.enable', {}, sid);
await send('Log.enable', {}, sid);
await send('Network.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Page.navigate', { url }, sid);
await sleep(Number(secs) * 1000);
ws.close();

const bad = (t) => ['error', 'warning', 'warn', 'assert', 'exception'].includes(t);
console.log(
  JSON.stringify(
    {
      url,
      seconds: Number(secs),
      console: console_,
      consoleErrorsOrWarnings: console_.filter((c) => bad(c.type)),
      logEntries: logs,
      logErrorsOrWarnings: logs.filter((l) => bad(l.level)),
      networkCount: requests.size,
      networkNotOk: [...requests.values()].filter(
        (r) => typeof r.status !== 'number' || r.status >= 400,
      ),
      network: [...requests.values()],
    },
    null,
    2,
  ),
);
