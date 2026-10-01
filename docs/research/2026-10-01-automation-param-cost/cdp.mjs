// A minimal Chrome DevTools Protocol client for the headed runs of the
// windsor#343 probe, with Node 24's own WebSocket and no dependencies.
//
//   node cdp.mjs launch <port> <profile-dir> <url>   start a headed Chrome
//   node cdp.mjs run <port> <file>                   run the async expression in
//                                                    <file> in the first page and
//                                                    print its JSON result
//   node cdp.mjs reload <port>                       reload the first page
//
// The headed Chrome is the installed Google Chrome, started with its own
// throwaway profile, `--mute-audio` (it renders, the speakers stay quiet) and
// `--autoplay-policy=no-user-gesture-required` (the probe's clicks are
// script clicks).
/* global process, fetch, WebSocket, console */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [command, port, ...rest] = process.argv.slice(2);

async function page() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((t) => t.type === 'page');
  if (!target) throw new Error('no page target');
  return target.webSocketDebuggerUrl;
}

async function send(method, params) {
  const socket = new WebSocket(await page());
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const reply = new Promise((resolve) => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) resolve(message);
    };
  });
  socket.send(JSON.stringify({ id: 1, method, params }));
  const message = await reply;
  socket.close();
  return message;
}

if (command === 'launch') {
  const [profile, url] = rest;
  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      // The render's stops wait on setTimeout; a window behind others must
      // not have its timers throttled.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      url,
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  console.log(`launched pid ${child.pid}`);
} else if (command === 'run') {
  const message = await send('Runtime.evaluate', {
    expression: readFileSync(rest[0], 'utf8'),
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(JSON.stringify(message.result?.result?.value ?? message, null, 1));
} else if (command === 'reload') {
  console.log(JSON.stringify(await send('Page.reload', {})));
} else {
  console.error('usage: node cdp.mjs launch|run|reload <port> …');
  process.exit(2);
}
