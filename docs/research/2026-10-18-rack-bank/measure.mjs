/* global console, process, URL */
/**
 * The first rack bank's economy (windsor#878 decision 4), one command from
 * the repository root:
 *
 *   node docs/research/2026-10-18-rack-bank/measure.mjs [--rounds 2] [--seconds 6] [--renders 6]
 *
 * Every rack is added to a drum-heavy and a pad-heavy song (`pageEconomy.mjs`)
 * twice, with its chain and with its chain emptied after the load, in a
 * headless Chromium of its own. Live, the engine's load report is read for
 * `--seconds` after a 3 s warm-up, `--rounds` times, the chain and the bare
 * case alternating which goes first; offline, `renderSong` is timed
 * `--renders` times after one warm-up render of each, alternating which
 * goes first. The rack's insert load is the median of the paired
 * differences. Writes `measurement.json` beside this file and prints the
 * README's table.
 */
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { launch, openPage, serve } from './browser.mjs';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const ROUNDS = arg('--rounds', 2);
const SECONDS = arg('--seconds', 6);
const RENDERS = arg('--renders', 6);
const BACKGROUNDS = ['drums', 'pads'];

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** One case's live readings and offline timings, the chain's and the bare one's paired. */
async function measureCase(page, rack, background) {
  const call = (fn, bare, ...rest) =>
    page.evaluate(`rackBank.${fn}(${JSON.stringify({ background, rack, bare })}${rest.map((r) => `, ${r}`).join('')})`);
  const live = [];
  for (let round = 0; round < ROUNDS; round++) {
    const order = round % 2 ? [true, false] : [false, true];
    const got = {};
    for (const bare of order) got[bare] = await call('live', bare, SECONDS);
    live.push({ chain: got.false, bare: got.true });
  }
  // One render of each first, discarded: the chain's processors compile and warm on it.
  await call('offline', false);
  await call('offline', true);
  const offline = [];
  for (let i = 0; i < RENDERS; i++) {
    const got = {};
    for (const bare of i % 2 ? [true, false] : [false, true]) got[bare] = await call('offline', bare);
    offline.push({ chain: got.false, bare: got.true });
  }
  return {
    rack,
    background,
    loadPct: median(live.map((r) => r.chain.loadPct - r.bare.loadPct)),
    loadPctWith: median(live.map((r) => r.chain.loadPct)),
    loadPctBare: median(live.map((r) => r.bare.loadPct)),
    clockRate: Math.min(...live.flatMap((r) => [r.chain.clockRate, r.bare.clockRate])),
    msPerSecond: median(offline.map((r) => r.chain.msPerAudioSecond - r.bare.msPerAudioSecond)),
    msPerSecondBare: median(offline.map((r) => r.bare.msPerAudioSecond)),
    live,
    offline,
    load1: loadavg()[0],
  };
}

const { server, base } = await serve();
const browser = await launch();
const results = [];
try {
  const page = await openPage(browser, base);
  const racks = await page.evaluate('rackBank.ids()');
  for (const background of BACKGROUNDS)
    for (const rack of racks) {
      const r = await measureCase(page, rack, background);
      results.push(r);
      console.log(
        `${background} ${rack}: load ${r.loadPct.toFixed(1)} % (${r.loadPctBare.toFixed(1)} → ${r.loadPctWith.toFixed(1)}), ` +
          `offline ${r.msPerSecond.toFixed(1)} ms/s (bare ${r.msPerSecondBare.toFixed(1)}), clock ≥ ${r.clockRate.toFixed(3)}`,
      );
    }
  await page.close();
} finally {
  await browser.close();
  server.close();
}
const machine = { cpu: cpus()[0].model, cores: cpus().length, node: process.version, browser: browser.product };
const settings = { rounds: ROUNDS, seconds: SECONDS, renders: RENDERS, date: new Date().toISOString() };
writeFileSync(
  new URL('measurement.json', import.meta.url),
  `${JSON.stringify({ machine, settings, results }, null, 2)}\n`,
);
