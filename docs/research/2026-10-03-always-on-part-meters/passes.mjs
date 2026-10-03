/** windsor#533: one round's passes, each on a fresh page with a fresh AudioContext.
 *   - audio: one page per case × variant; the count steps through BENCH.segments while
 *     the audio categories are traced, so every N is paired with N = 0 on one context;
 *   - main: one page per case × variant × count in BENCH.mainCounts, traced for the
 *     main thread over BENCH.traceSeconds;
 *   - offline: #211's render-time method on the isolated graph, every variant × N.
 */
import { loadavg } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { BENCH } from './benchConstants.mjs';
import { openPage, trace } from './cdp.mjs';
import { audioPass, mainPass } from './analyse.mjs';

const MS_PER_SECOND = 1000;

/** Every pass of one round, each kind's list rotated by the round. */
export function plan(round) {
  const audio = [];
  const main = [];
  for (const c of BENCH.cases) {
    main.push({ kind: 'main', case: c, variant: 'none', n: 0 });
    for (const variant of BENCH.variants) {
      audio.push({ kind: 'audio', case: c, variant });
      for (const n of BENCH.mainCounts.filter((k) => k > 0))
        main.push({ kind: 'main', case: c, variant, n });
    }
  }
  const rotate = (list) => list.map((_, i) => list[(i + round) % list.length]);
  return [...rotate(audio), ...rotate(main)];
}

/** The segment counts for a round: the blocks in an order rotated by the round. */
export function schedule(round) {
  const { blocks } = BENCH.segments;
  return blocks.flatMap((_, i) => blocks[(i + round) % blocks.length]);
}

async function ready(page) {
  for (let waited = 0; waited < BENCH.readyTimeoutMs; waited += BENCH.readyPollMs) {
    if (await page.evaluate('typeof window.bench === "object"')) return;
    await sleep(BENCH.readyPollMs);
  }
  throw Error('page never ready');
}

/** Step through the counts; each segment's report rate from the counters either side. */
async function segments(page, counts, timing) {
  const steps = [];
  for (const n of counts) {
    const at = await page.evaluate(`bench.setMeters(${n})`);
    await sleep(timing.segmentSeconds * MS_PER_SECOND);
    steps.push({ n, at });
  }
  const closing = await page.evaluate('bench.setMeters(0)');
  return steps.map((step, i) => {
    const end = (steps[i + 1]?.at ?? closing).before;
    const seconds = (end.wallMs - step.at.after.wallMs) / MS_PER_SECOND;
    return {
      n: step.n,
      messagesPerSecond: (end.messages - step.at.after.messages) / seconds,
      audioClockRate: (end.audioSeconds - step.at.after.audioSeconds) / seconds,
    };
  });
}

async function audio(browser, page, config, timing) {
  const counts = schedule(config.round);
  const { events, result } = await trace(browser, BENCH.categories.audio, () =>
    segments(page, counts, timing),
  );
  return { ...audioPass(events, BENCH.percentile, BENCH.segments.guardSeconds), segments: result };
}

async function main(browser, page, config, timing) {
  await page.evaluate(`bench.setMeters(${config.n})`);
  await sleep(timing.warmupSeconds * MS_PER_SECOND);
  const { events, result } = await trace(browser, BENCH.categories.main, async () => {
    const before = await page.evaluate('bench.counters()');
    await sleep(timing.traceSeconds * MS_PER_SECOND);
    return { before, after: await page.evaluate('bench.counters()') };
  });
  const { before, after } = result;
  const seconds = (after.wallMs - before.wallMs) / MS_PER_SECOND;
  return {
    ...mainPass(events),
    messagesPerSecond: (after.messages - before.messages) / seconds,
    audioClockRate: (after.audioSeconds - before.audioSeconds) / seconds,
  };
}

export async function pass(browser, base, config, timing) {
  const page = await openPage(browser, base);
  const load = { before: loadavg() };
  try {
    await ready(page);
    const setup = await page.evaluate(`bench.setup(${JSON.stringify(config)})`);
    await sleep(timing.warmupSeconds * MS_PER_SECOND);
    const measured =
      config.kind === 'audio'
        ? await audio(browser, page, config, timing)
        : await main(browser, page, config, timing);
    load.after = loadavg();
    return { ...config, setup, load, ...measured };
  } catch (error) {
    return { ...config, error: String(error), load };
  } finally {
    await page.close();
  }
}

export async function offline(browser, base, round, repeats) {
  const page = await openPage(browser, base);
  const records = [];
  const counts = BENCH.counts.filter((n) => n > 0);
  const configs = [
    { variant: 'none', n: 0 },
    ...BENCH.variants.flatMap((variant) => counts.map((n) => ({ variant, n }))),
  ];
  try {
    await ready(page);
    for (let repeat = 0; repeat < repeats; repeat++)
      for (const [i] of configs.entries()) {
        const config = configs[(i + round + repeat) % configs.length];
        const result = await page.evaluate(`bench.offline(${JSON.stringify(config)})`);
        records.push({ kind: 'offline', case: 'isolated', round, repeat, ...config, ...result });
      }
  } finally {
    await page.close();
  }
  return records;
}
