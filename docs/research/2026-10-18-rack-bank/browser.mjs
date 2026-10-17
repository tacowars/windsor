/* global process, URL, WebSocket */
/**
 * The headless browser the rack bank's listen and measurement run in: the
 * page bundled from `page.mjs` with esbuild and served on 127.0.0.1 beside
 * the engine's generated worklet bundles, byte for byte, and a headless
 * Chromium of its own with a throwaway profile, driven over the DevTools
 * protocol on Node's own WebSocket. The protocol client and the switches a
 * container needs are the performance assessment's `cdp.mjs`
 * (`docs/research/2026-10-13-performance-assessment/`). `WINDSOR_CHROME`
 * names the browser binary.
 */
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const CHROME =
  process.env.WINDSOR_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const folder = new URL('./', import.meta.url);
const generated = new URL('../../../packages/engine/src/worklet/generated/', import.meta.url);
const PAGE_PATH = '/src/bench/page.js';
const POLL_MS = 50;
const POLLS = 400;
const READY_POLLS = 200;

const SWITCHES = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-extensions',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

/** The page and the worklet bundles, keyed by the path the page asks for. */
async function files() {
  const html = `<!doctype html><title>Rack bank</title><script type="module" src="${PAGE_PATH}"></script>`;
  const page = await build({
    entryPoints: [new URL('page.mjs', folder).pathname],
    bundle: true,
    write: false,
    target: 'esnext',
    format: 'esm',
    loader: { '.json': 'json' },
  });
  // The engine resolves its worklets with `new URL('../worklet/generated/…', import.meta.url)`,
  // so the page sits where that lands on the served copies.
  const served = { '/': ['text/html', html], [PAGE_PATH]: ['text/javascript', page.outputFiles[0].text] };
  for (const name of readdirSync(generated).filter((n) => n.endsWith('.js')))
    served[`/src/worklet/generated/${name}`] = [
      'text/javascript',
      readFileSync(new URL(name, generated), 'utf8'),
    ];
  return served;
}

/** Serve the page; resolves to the server and its base URL. */
export async function serve() {
  const served = await files();
  const server = createServer((req, res) => {
    const [type, text] = served[req.url.split('?')[0]] ?? ['text/plain', ''];
    res.setHeader('content-type', type);
    res.end(text);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/` };
}

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = new Set();
  let id = 0;
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const waiting = pending.get(message.id);
    if (!waiting) return listeners.forEach((listen) => listen(message));
    pending.delete(message.id);
    if (message.error) waiting.reject(Error(JSON.stringify(message.error)));
    else waiting.resolve(message.result);
  };
  const send = (method, params = {}, sessionId = undefined) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return opened.then(() => ({ ws, send, listeners }));
}

/** A headless Chromium with a throwaway profile under `/tmp`; `close()` removes it. */
export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'windsor-878-chrome-'));
  const chrome = spawn(CHROME, [...SWITCHES, `--user-data-dir=${profile}`, 'about:blank'], {
    stdio: 'ignore',
  });
  const file = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < POLLS && !existsSync(file); i++) await sleep(POLL_MS);
  const [port, path] = readFileSync(file, 'utf8').trim().split('\n');
  const browser = await connect(`ws://127.0.0.1:${port}${path}`);
  const { product } = await browser.send('Browser.getVersion');
  const close = async () => {
    browser.ws.close();
    chrome.kill('SIGTERM');
    if (chrome.exitCode === null) await new Promise((resolve) => chrome.once('exit', resolve));
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { ...browser, product, close };
}

/** A page at `url` with `evaluate(expression)`, once `window.rackBank` is up. */
export async function openPage(browser, url) {
  const { targetId } = await browser.send('Target.createTarget', { url });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  await browser.send('Runtime.enable', {}, sessionId);
  const logs = [];
  browser.listeners.add((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown')
      logs.push(`exception: ${message.params.exceptionDetails.exception?.description}`);
  });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await browser.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (exceptionDetails) throw Error(exceptionDetails.exception?.description ?? 'evaluate');
    return result.value;
  };
  for (let i = 0; i < READY_POLLS; i++) {
    if (await evaluate('typeof window.rackBank === "object"')) break;
    if (i === READY_POLLS - 1) throw Error(`page never ready: ${logs.join(' | ')}`);
    await sleep(POLL_MS);
  }
  const close = () => browser.send('Target.closeTarget', { targetId });
  return { evaluate, close };
}
