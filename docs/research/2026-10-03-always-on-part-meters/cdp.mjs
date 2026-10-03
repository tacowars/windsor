/** windsor#533: a minimal DevTools protocol client on Node 24's own WebSocket, no
 * dependencies. It starts the installed Chrome headless with a throwaway profile, muted
 * and with background throttling off (#343's `cdp.mjs` switches), opens pages, evaluates
 * in them and records traces over the browser connection.
 */
/* global WebSocket */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT_FILE_POLL_MS = 50;
const PORT_FILE_POLLS = 200;

const SWITCHES = [
  '--headless=new',
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

/** Chrome, headless, on a fresh profile; `close()` ends it and removes the profile. */
export async function launch(chromePath) {
  const profile = mkdtempSync(join(tmpdir(), 'windsor-meters-'));
  const chrome = spawn(chromePath, [...SWITCHES, `--user-data-dir=${profile}`, 'about:blank'], {
    stdio: 'ignore',
  });
  const file = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < PORT_FILE_POLLS && !existsSync(file); i++) await sleep(PORT_FILE_POLL_MS);
  const [port, path] = readFileSync(file, 'utf8').trim().split('\n');
  const browser = await connect(`ws://127.0.0.1:${port}${path}`);
  const close = async () => {
    browser.ws.close();
    chrome.kill('SIGTERM');
    if (chrome.exitCode === null) await new Promise((resolve) => chrome.once('exit', resolve));
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { ...browser, close };
}

/** A new page at `url`, with `evaluate` (awaited, by value) and `close`. */
export async function openPage(browser, url) {
  const { targetId } = await browser.send('Target.createTarget', { url });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await browser.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (exceptionDetails) throw Error(exceptionDetails.exception?.description ?? 'evaluate');
    return result.value;
  };
  const close = () => browser.send('Target.closeTarget', { targetId });
  return { evaluate, close };
}

/** Every trace event recorded while `during()` runs, with only `categories` enabled. */
export async function trace(browser, categories, during) {
  const events = [];
  const complete = new Promise((resolve) => {
    const listen = (message) => {
      if (message.method === 'Tracing.dataCollected') events.push(...message.params.value);
      if (message.method !== 'Tracing.tracingComplete') return;
      browser.listeners.delete(listen);
      resolve();
    };
    browser.listeners.add(listen);
  });
  await browser.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: { includedCategories: categories, recordMode: 'recordAsMuchAsPossible' },
  });
  const result = await during();
  await browser.send('Tracing.end');
  await complete;
  return { events, result };
}
