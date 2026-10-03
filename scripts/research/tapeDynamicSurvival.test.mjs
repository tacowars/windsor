/** Verification fixtures for windsor#204; not additional survival experiments. */
import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import {
  DYNAMIC as D,
  schedule,
} from '../../docs/research/2026-09-30-tape-dynamic-survival/dynamicConstants.ts';
import * as P from '../../docs/research/2026-09-30-tape-dynamic-survival/program.ts';
import {
  renderConditioned,
  pulseField,
  subgrid,
} from '../../docs/research/2026-09-30-tape-conditioning/conditioning.ts';
import { playback } from '../../docs/research/2026-09-30-tape-filtered-reference/filteredReference.ts';
import { Hysteresis } from '../../docs/research/2026-09-30-tape-phase-3/hysteresis.ts';
import { recoverJournal } from '../../docs/research/2026-09-30-tape-conditioning/journal.mjs';
import * as V from '../../docs/research/2026-09-30-tape-dynamic-survival/evidence.mjs';
import { importClosure } from '../../docs/research/2026-09-30-tape-dynamic-survival/measure.mjs';

const dir = new URL('../../docs/research/2026-09-30-tape-dynamic-survival/', import.meta.url);
const bytes = (path) => readFileSync(new URL(path, dir));
const rows = schedule(D);
const setting = (t) => `${t.solver}/${t.factor}`;
const idle = { peaks: { slope: 0, nonfinite: 0 }, reset: () => {} };
const segment = (name, extra = {}) => ({
  ...{ name, reached: true, finite: true, resets: 0, clips: 0, failure: null },
  ...{ failureIndex: null, failureTime: null, failureControls: null, failureField: null },
  ...extra,
});
const synthetic = (row, extra = {}) =>
  row.part === 'static'
    ? { ...row, finite: true, failure: null, failureIndex: null, resets: 0, clips: 0, ...extra }
    : { ...row, final: 0, segments: D.segments.map((s) => segment(s.name)), ...extra };
const entries = (trials) => trials.map((value) => ({ kind: 'trial', value }));
const run = { expired: false, exitCode: 0, truncatedTail: null, elapsedMs: 1 };
const assembled = (trials, r = run) => V.assemble(entries(trials), r, D);
const all = () => rows.map((r) => synthetic(r));
/** The whole program at 1/1000 scale, for attribution tests that must run quickly. */
const milli = (x) => Math.round(x * 1e6) / 1e9;
const compact = {
  ...D,
  seconds: milli(D.seconds),
  edge: milli(D.edge),
  spike: { width: milli(D.spike.width), every: milli(D.spike.every) },
  schedule: { ...D.schedule, step: 0.001 },
  remanence: 0.001,
  segments: D.segments.map((s) => ({
    ...s,
    start: milli(s.start),
    end: milli(s.end),
    ...(s.levels ? { levels: s.levels.map(([t, l]) => [milli(t), l]) } : {}),
    ...(Array.isArray(s.controls)
      ? { controls: s.controls.map((c) => ({ ...c, at: milli(c.at) })) }
      : {}),
  })),
};

describe('Declared matrix and program', () => {
  it('declares four settings, three rates, nine points and 228 trajectories in run order', () => {
    expect(D.settings.map(setting)).toEqual(['rk4/8', 'rk4/2', 'rk4/4', 'rk2/8']);
    expect([D.rates, D.domain, D.policy, D.frames, D.seconds, D.budgetMs]).toEqual([
      ...[[48000, 44100, 96000], 4, 'knee', 512, 60, 900000],
    ]);
    expect(D.points).toHaveLength(9);
    expect(new Set(D.points.map((p) => p.join())).size).toBe(9);
    expect(rows).toHaveLength(228);
    expect(rows.slice(0, 216).every((r) => r.part === 'static')).toBe(true);
    const dynamic = rows.slice(216);
    expect(dynamic.map((r) => `${r.rate}:${setting(r)}`).slice(0, 5)).toEqual([
      ...['48000:rk4/8', '48000:rk4/2', '48000:rk4/4', '48000:rk2/8', '44100:rk4/8'],
    ]);
    const spans = D.segments.map((s) => `${s.name}:${s.start}-${s.end}`).join();
    expect(spans).toBe(
      'ramp:0-10,edits:10-20,corners:20-30,dc:30-40,opposite:40-45,spikes:45-55,silence:55-60',
    );
  });
  it('matches the analytic derivative to a central difference on every segment and rate', () => {
    const { tolerance, floor, step: h } = D.derivative;
    const out = new Float64Array(2),
      f = (u, rate) => (P.fieldAt(u, out, rate), out[0]);
    const check = (u, rate) => {
      const fd =
        (8 * (f(u + h, rate) - f(u - h, rate)) - (f(u + 2 * h, rate) - f(u - 2 * h, rate))) /
        (12 * h);
      P.fieldAt(u, out, rate);
      return Math.abs(fd - out[1]) / Math.max(Math.abs(out[1]), floor);
    };
    const snap = (u) => Math.round(u * 16) / 16;
    for (const rate of D.rates) {
      const points = D.segments.flatMap((s) => {
        const span = (s.end - s.start) * rate;
        const grid = Array.from({ length: 64 }, (_, q) => s.start * rate + ((q + 0.5) / 64) * span);
        const edges = (s.levels ?? []).flatMap(([t]) =>
          [0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (t + v * D.edge) * rate),
        );
        const every = s.field === 'spikes' ? [0, 1, 2, 39] : [];
        const at = (k, v) => (s.start + k * D.spike.every + v * D.spike.width) * rate;
        const bumps = every.flatMap((k) => [0.1, 0.3, 0.5, 0.7, 0.9].map((v) => at(k, v)));
        return [...grid, ...edges, ...bumps].map(snap);
      });
      const worst = Math.max(...points.map((u) => check(u, rate)));
      expect(worst).toBeLessThanOrEqual(tolerance);
      expect(points.length).toBeGreaterThan(7 * 64 + 30);
    }
  });
  it('keeps segment boundaries exact, the field continuous and inside the domain', () => {
    const out = new Float64Array(2);
    for (const rate of D.rates) {
      for (const [i, b] of P.segmentFrames(rate).entries()) {
        expect([Number.isInteger(b.start), Number.isInteger(b.end)]).toEqual([true, true]);
        expect(P.segmentAt(b.start, rate)).toBe(i);
        if (i) expect(P.segmentAt(b.start - 2 ** -4, rate)).toBe(i - 1);
        P.fieldAt(b.start - 2 ** -20, out, rate);
        const before = out[0];
        P.fieldAt(b.start, out, rate);
        expect(Math.abs(out[0] - before)).toBeLessThan(1e-4);
      }
      let peak = 0;
      for (let u = 0; u <= D.seconds * rate; u += 7.0625)
        peak = Math.max(peak, Math.abs((P.fieldAt(u, out, rate), out[0])));
      expect(peak).toBeLessThanOrEqual(D.domain);
      expect(P.segmentAt(D.seconds * rate, rate)).toBe(D.segments.length - 1);
    }
  });
  it('visits every corner and the center at least ten times, changing every 50 ms', () => {
    const scheduled = P.controlSchedule(D);
    expect(scheduled).toHaveLength(200);
    for (const point of D.points)
      expect(scheduled.filter((c) => c.join() === point.join()).length).toBeGreaterThanOrEqual(10);
    expect(scheduled.every((c, i) => !i || c.join() !== scheduled[i - 1].join())).toBe(true);
    expect(scheduled.flat().every((x) => x >= 0 && x <= 1)).toBe(true);
    expect(P.controlSchedule(D)).toEqual(scheduled);
    for (const rate of D.rates) {
      const changes = P.controlChanges(rate);
      expect(changes[0].frame).toBe(0);
      expect(
        changes.every(
          (c, i) => Number.isInteger(c.frame) && (!i || c.frame > changes[i - 1].frame),
        ),
      ).toBe(true);
      const edits = changes.filter((c) => c.frame >= 10 * rate && c.frame < 20 * rate);
      expect(edits.map((c) => c.frame - 10 * rate)).toEqual(edits.map((_, k) => (k * rate) / 20));
    }
  });
});

describe('Stepping loop and playback', () => {
  it('reproduces renderConditioned exactly on the static ±4 center pulse at RK4/4x, 48 kHz', () => {
    const rate = 48000,
      factor = 4;
    for (const level of [4, -4]) {
      const row = rows.find(
        (r) =>
          r.part === 'static' &&
          r.rate === rate &&
          r.level === level &&
          r.controls.join() === D.center.join() &&
          setting(r) === 'rk4/4',
      );
      const field = subgrid(pulseField(level, 0, 8), factor);
      const plain = renderConditioned({ ...row, signal: row, field, frames: D.frames });
      const states = [];
      const r = P.integrate({
        ...{ rate, factor, solver: 'rk4', policy: 'knee', steps: D.frames * factor },
        source: (k, out) => ((out[0] = field.at(k)), (out[1] = rate * field.at(k, true))),
        changes: [{ step: 0, controls: row.controls }],
        hooks: { state: (_, m) => states.push(m) },
      });
      const s = Float64Array.from(states);
      expect([r.failure, r.final]).toEqual([null, plain.final]);
      expect(Array.from(s.filter((_, i) => i % factor === 0))).toEqual(Array.from(plain.raw));
      expect(Array.from(playback(s, factor, D.frames))).toEqual(Array.from(plain.output));
    }
  });
  it('streams playback bit-identically to the whole-array call', () => {
    const factor = 4,
      frames = 1000,
      chunk = 100;
    const states = Float64Array.from(
      { length: frames * factor },
      (_, i) => Math.sin(i * 0.37) * Math.cos(i * 0.011),
    );
    const got = new Float64Array(frames);
    const push = P.streamedPlayback(factor, chunk, (n, y) => (got[n] = y));
    for (const m of states) push(m);
    expect(Array.from(got)).toEqual(Array.from(playback(states, factor, frames)));
  });
  it('attributes a synthetic guard failure to its segment, time, controls and polarity', () => {
    const rate = 48000,
      factor = 2;
    const dc = P.segmentFrames(rate, compact).find((b) => b.name === 'dc');
    const fail = dc.start * factor + 101;
    const original = Hysteresis.prototype.slope;
    let calls = 0;
    Hysteresis.prototype.slope = function (...args) {
      return calls++ === 4 * fail ? NaN : original.apply(this, args);
    };
    try {
      const r = P.runProgram({
        rate,
        setting: { solver: 'rk4', factor },
        observer: idle,
        reference: null,
        table: compact,
      });
      const names = r.segments.map((s) => s.name);
      const k = names.indexOf('dc');
      expect(r.segments.slice(0, k).every(V.segmentSurvives)).toBe(true);
      expect(r.segments[k]).toMatchObject({
        reached: true,
        finite: false,
        failureIndex: fail,
        failureTime: fail / (rate * factor),
        failureControls: D.center,
      });
      expect(r.segments[k].failure).toContain('Invalid reference state');
      expect(Math.sign(r.segments[k].failureField)).toBe(1);
      expect(r.segments.slice(k + 1).every((s) => !s.reached && s.finite === null)).toBe(true);
      expect(Array.from(r.trace.raw.slice(Math.ceil(fail / factor))).every(Number.isNaN)).toBe(
        true,
      );
      const trial = { ...rows[216], ...r, trace: undefined };
      const report = assembled(all().map((t, i) => (i === 216 ? trial : t)));
      const row = V.interpret(report, D).rows[0];
      expect(row).toMatchObject({ rate, setting: 'rk4/8', survives: false, statics: [] });
      expect(row.segments).toEqual([
        { segment: 'dc', time: fail / (rate * factor), controls: D.center, polarity: 1 },
      ]);
      expect(row.unreached).toEqual(names.slice(k + 1));
    } finally {
      Hysteresis.prototype.slope = original;
    }
  });
});

describe('Survival, inventory and recovery', () => {
  it('never lets a nonfinite, reset, clipped or failed state survive', () => {
    const bad = [
      { finite: false },
      { resets: 1 },
      { clips: 1 },
      { failure: 'Error: guard' },
      { reached: false },
    ];
    for (const extra of bad) {
      expect(V.segmentSurvives(segment('dc', extra))).toBe(false);
      if (!('reached' in extra)) {
        const staticRow = assembled(all().map((t, i) => (i === 5 ? { ...t, ...extra } : t)));
        expect(staticRow.survival.map((s) => s.survives)).toEqual([
          true,
          false,
          ...Array(10).fill(true),
        ]);
      }
      const segments = D.segments.map((s) => segment(s.name, s.name === 'spikes' ? extra : {}));
      const program = assembled(all().map((t, i) => (i === 220 ? { ...t, segments } : t)));
      expect(program.survival.filter((s) => s.survives !== true)).toHaveLength(1);
      expect(V.interpret(program, D).declaration.pairs).not.toContain('44100:rk4/8');
    }
    const report = assembled(all());
    expect(report.run.status).toBe('complete');
    expect(V.interpret(report, D).declaration).toMatchObject({
      settingsAtEveryRate: ['rk4/8', 'rk4/2', 'rk4/4', 'rk2/8'],
      ratesForEverySetting: D.rates,
      unqualified: [],
    });
  });
  it('marks missing rows of an expired run unqualified, never surviving', () => {
    const r = assembled(all().slice(0, 150), { ...run, expired: true, exitCode: null });
    expect(r.run).toMatchObject({
      status: 'incomplete',
      completedTrajectories: 150,
      scheduledTrajectories: 228,
    });
    expect(r.missing).toHaveLength(78);
    const d = V.interpret(r, D).declaration;
    expect(d.unqualified.length).toBeGreaterThan(0);
    for (const pair of d.unqualified) expect(d.pairs).not.toContain(pair);
    expect(r.survival.filter((s) => s.rate !== 48000).every((s) => s.survives === null)).toBe(true);
    expect(assembled([...all(), all()[0]]).run.status).toBe('incomplete');
  });
  it('recovers an interrupted journal and keeps its truncated tail', () => {
    const text = entries(all().slice(0, 40))
      .map((e) => JSON.stringify(e))
      .join('\n');
    const recovered = recoverJournal(`${text}\n{"kind":"tri`);
    expect(recovered.entries).toHaveLength(40);
    const r = V.assemble(
      recovered.entries,
      { expired: true, exitCode: null, truncatedTail: recovered.truncatedTail },
      D,
    );
    expect(r.run).toMatchObject({
      status: 'incomplete',
      completedTrajectories: 40,
      truncatedTail: '{"kind":"tri',
    });
    expect(r.missing).toHaveLength(188);
  });
});

describe('Saved report', () => {
  let saved;
  beforeAll(() => (saved = JSON.parse(bytes('measurement.json').toString('utf8'))));
  it('declares the table, stays within the bound and lists all 228 trajectories', () => {
    expect(saved.settings.dynamic).toEqual(JSON.parse(JSON.stringify(D)));
    expect(saved.run.expired || saved.run.elapsedMs <= D.budgetMs).toBe(true);
    const done = saved.trials.map(V.key);
    expect([...done, ...saved.missing].sort()).toEqual(rows.map(V.key).sort());
    expect(saved.trials).toHaveLength(saved.run.completedTrajectories);
  });
  it('hashes every source measure.mjs reaches, as committed', () => {
    const closure = importClosure();
    expect(closure).toContain('../../../packages/engine/src/sequencing/mulberry32.ts');
    expect(Object.keys(saved.sources).sort()).toEqual(closure);
    for (const path of closure)
      expect(saved.sources[path]).toBe(createHash('sha256').update(bytes(path)).digest('hex'));
  });
  it('reassembles the inventory and map from its own records', () => {
    const again = V.assemble(entries(saved.trials), saved.run, D);
    for (const key of ['survival', 'missing']) expect(again[key]).toEqual(saved[key]);
    expect(V.interpret(saved, D)).toEqual(saved.outcome);
  });
  it('recomputes the survival declaration independently from the rows', () => {
    const ok = (x) => x.finite === true && x.failure === null && x.resets === 0 && x.clips === 0;
    const pairs = [];
    for (const rate of D.rates)
      for (const s of D.settings) {
        const mine = saved.trials.filter((t) => t.rate === rate && setting(t) === setting(s));
        const statics = mine.filter((t) => t.part === 'static');
        const program = mine.filter((t) => t.part === 'dynamic');
        const fine =
          statics.length === 18 &&
          statics.every(ok) &&
          program.length === 1 &&
          program[0].segments.length === 7 &&
          program[0].segments.every((x) => x.reached && ok(x) && x.fieldPeak <= D.domain);
        if (fine) pairs.push(`${rate}:${setting(s)}`);
      }
    expect(saved.outcome.declaration.pairs).toEqual(pairs);
    const at = (s) => D.rates.every((r) => pairs.includes(`${r}:${s}`));
    expect(saved.outcome.declaration.settingsAtEveryRate).toEqual(
      D.settings.map(setting).filter(at),
    );
  });
  it('keeps the diagnostic difference on every non-reference program', () => {
    for (const t of saved.trials.filter((x) => x.part === 'dynamic')) {
      const reference = setting(t) === 'rk4/8';
      for (const s of t.segments) expect(s.difference === null).toBe(reference);
    }
  });
});
