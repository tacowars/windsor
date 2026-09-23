/* global AudioWorkletProcessor, registerProcessor, sampleRate, currentFrame */
/**
 * fmProcessor.js -- the FM part processor, the entry that
 * `scripts/build-worklets.mjs` bundles into `../generated/fm-processor.js`,
 * the one script every consumer reads (#643). One node == one timbral part;
 * instantiate several for multi-timbral use.
 *
 * Runs on the audio thread. The rules for every line under `fm/` are stated
 * in full in ../CLAUDE.md; the two that govern most edits:
 *   1. No allocation in process(): a GC pause is an audible dropout.
 *   2. Bit-identity by construction: the same IEEE operations in the same
 *      order, on every path (#548). `fmProcessorGolden.test.ts` is the gate.
 *
 * What this file owns: the parameter descriptors, the message port (patch,
 * notes, live retune, load sampling), the frame-stamped event queue, voice
 * allocation and stealing, and `renderBlock`, which walks each active voice
 * up to the next event or control boundary. Everything a voice does is
 * `voice.js` and the modules beside it; the patch schema and algorithm
 * tables are mirrored in ../../patch.ts (`patch.test.ts`, until #656).
 */

import { CTRL_INTERVAL } from './fmConstants.js';
import { normalisePatch, num } from './patchNormalise.js';
import { makeRandom } from './prng.js';
import { Voice } from './voice.js';
import { WAVE, getMips } from './waveTables.js';

/* ------------------------------------------------------------------ *
 * The processor — one timbral part
 * ------------------------------------------------------------------ */

class FmPartProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitchBend', defaultValue: 0, minValue: -48, maxValue: 48, automationRate: 'k-rate' },
      { name: 'modWheel', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'cutoffMod', defaultValue: 0, minValue: -8, maxValue: 8, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    const maxVoices = Math.max(1, Math.min(128, opts.maxVoices || 16));
    this.maxVoices = maxVoices;

    // One random source for the whole part. Absent `seed` this is Math.random,
    // which is what the game gets; see "Randomness" near the top of the file.
    this.random = makeRandom(opts.seed);

    // Four reserve slots above the sounding limit so a stolen voice can fade
    // out while its replacement is already sounding.
    const poolSize = maxVoices + 4;
    this.voices = new Array(poolSize);
    for (let i = 0; i < poolSize; i++) this.voices[i] = new Voice(sampleRate, this.random);

    this.patch = normalisePatch(opts.patch);
    this.waveSets = [null, null, null, null];
    this.rebuildWaves();

    this.events = []; // frame-stamped, kept sorted
    this.noteMap = new Map(); // noteId -> array of voice indices
    this.lastNote = null; // for legato glide
    this.running = true;
    // Off in the game; the console turns it on so a knob retunes ringing voices.
    this.liveRetune = false;
    // Seconds a slid note glides when the patch's `glide` is 0 (#602).
    this.slideSeconds = num(opts.slideSeconds, 0);
    // Skipping silent held voices (#547). Always on in the game and the console;
    // `dormancy: false` exists so a test can render the same part without it and
    // prove the two renders agree.
    this.dormancy = opts.dormancy !== false;
    // The fixed-index voice kernel and per-note constants (#548), on in the game
    // and the console; `specialise: false` renders every voice through the
    // generic loop, so a test can prove the two agree bit for bit.
    const specialise = opts.specialise !== false;
    for (let i = 0; i < poolSize; i++) this.voices[i].specialise = specialise;

    // Audio-load sampler (#445), off until a `reportLoad` message turns it on,
    // so an offline render and the Node harness time nothing and post nothing.
    // See workletMessages.ts for why this counts millisecond boundaries rather
    // than timing the call: AudioWorkletGlobalScope has no performance.now(),
    // and Date.now() cannot resolve a 2.9 ms quantum on its own.
    this.loadQuanta = 0; // report cadence in quanta; 0 = not reporting
    this.loadCount = 0; // quanta since the last report
    this.loadBusyMs = 0;
    this.loadPeakMs = 0;
    this.loadUnderruns = 0; // cumulative, never reset
    this.loadWallStart = 0;
    this.loadBudgetMs = (128 / sampleRate) * 1000;

    // Events supplied at construction. port.postMessage() is delivered
    // asynchronously and can lose the race against OfflineAudioContext's
    // startRendering(), so offline renders must pass their notes this way.
    if (Array.isArray(opts.events)) {
      for (const ev of opts.events) this.schedule(ev, ev.frame);
    }

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  rebuildWaves() {
    const p = this.patch;
    for (let i = 0; i < 4; i++) {
      const op = p.ops[i];
      if (op.wave === WAVE.NOISE || op.wave === WAVE.SAW_D || op.wave === WAVE.SQUARE_D) {
        this.waveSets[i] = null;
      } else {
        this.waveSets[i] = getMips(op.wave, sampleRate, p.tone, op.userPartials);
      }
    }
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'patch': {
        this.patch = normalisePatch(msg.patch);
        this.rebuildWaves();
        // By default live voices keep their old patch reference until they
        // finish, which avoids clicks when a preset swaps under a ringing note.
        // The console opts into hearing the knob as it turns instead.
        if (this.liveRetune) {
          for (const v of this.voices) if (v.active) v.rebind(this.patch, this.waveSets);
        }
        break;
      }
      case 'liveRetune':
        this.liveRetune = !!msg.enabled;
        break;
      case 'noteOn':
        this.schedule(msg, msg.frame);
        break;
      case 'noteOff':
        this.schedule(msg, msg.frame);
        break;
      case 'allNotesOff':
        // Queued future events are cancelled too: a mute or a live rebuild
        // (#69) must not let the scheduler's look-ahead keep sounding. Unlike
        // panic, voices already sounding still release with their tails.
        for (const v of this.voices) this.releaseVoice(v);
        this.noteMap.clear();
        this.events.length = 0;
        break;
      case 'panic':
        for (const v of this.voices) v.kill();
        this.noteMap.clear();
        this.events.length = 0;
        break;
      case 'stop':
        this.running = false;
        break;
      case 'reportLoad':
        // #445: start (or restart) the duty-cycle sampler. The cumulative
        // underrun count survives a restart; the interval accumulators do not.
        this.loadQuanta = Math.max(0, msg.quanta | 0);
        this.loadCount = 0;
        this.loadBusyMs = 0;
        this.loadPeakMs = 0;
        this.loadWallStart = Date.now();
        break;
    }
  }

  /**
   * One quantum's duty-cycle sample, and the once-per-interval post (#445).
   * `t1 - t0` is not a duration: it is the number of integer-millisecond
   * boundaries that fell inside the render, which is what makes this a
   * sampler rather than a timer. Allocates only at the post.
   */
  sampleLoad(t0, t1) {
    const spanMs = t1 - t0;
    this.loadBusyMs += spanMs;
    if (spanMs > this.loadPeakMs) this.loadPeakMs = spanMs;
    // N boundary crossings prove only that the render took MORE THAN N-1 ms:
    // a 2.2 ms quantum from 1000.9 to 1003.1 crosses three and would count as
    // an overrun of a 2.902 ms budget if the count were read as a duration.
    // So the provable lower bound is `spanMs - 1`, and only that may accuse a
    // quantum of missing its deadline (#445 review, pass 1 and 2).
    if (spanMs - 1 >= this.loadBudgetMs) this.loadUnderruns++;
    if (++this.loadCount < this.loadQuanta) return;
    this.port.postMessage({
      type: 'load',
      busyMs: this.loadBusyMs,
      wallMs: t1 - this.loadWallStart,
      quanta: this.loadCount,
      peakMs: this.loadPeakMs,
      underruns: this.loadUnderruns,
    });
    this.loadCount = 0;
    this.loadBusyMs = 0;
    this.loadPeakMs = 0;
    this.loadWallStart = t1;
  }

  schedule(ev, frame) {
    ev._frame = typeof frame === 'number' ? frame : currentFrame;
    // Insertion sort from the back: events usually arrive in order.
    const q = this.events;
    let i = q.length;
    while (i > 0 && q[i - 1]._frame > ev._frame) i--;
    q.splice(i, 0, ev);
  }

  /**
   * Pick a voice.
   *
   * If the part is already at its sounding limit, the least valuable voice is
   * asked to fade out (4 ms) rather than being cut dead, and the new note takes
   * a reserve slot. Only an exhausted pool falls back to a hard kill.
   *
   * Priority for stealing: dormant (#547), oldest first, killed outright since
   * it is silent and needs no fade; then already released, oldest first;
   * otherwise oldest. A dormant voice counts as sounding, so the pool never
   * holds more than the limit.
   */
  allocate() {
    const vs = this.voices;
    let free = null;
    let sounding = 0;
    let bestDormant = null,
      bestDormantAge = -1;
    let bestReleased = null,
      bestReleasedAge = -1;
    let bestAny = null,
      bestAnyAge = -1;

    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && v.finished && !v.fading) v.active = false;

      if (!v.active) {
        if (!free) free = v;
        continue;
      }
      if (v.fading) continue; // sounding but already on its way out

      sounding++;
      if (this.dormancy && v.age > bestDormantAge && v.dormant) {
        bestDormantAge = v.age;
        bestDormant = v;
      }
      if (!v.gate && v.age > bestReleasedAge) {
        bestReleasedAge = v.age;
        bestReleased = v;
      }
      if (v.age > bestAnyAge) {
        bestAnyAge = v.age;
        bestAny = v;
      }
    }

    if (sounding >= this.maxVoices) {
      if (bestDormant) {
        bestDormant.kill();
        return bestDormant;
      }
      const victim = bestReleased || bestAny;
      if (victim) victim.steal();
    }

    if (free) return free;

    // Pool exhausted (many simultaneous fades). Take the oldest outright.
    let oldest = vs[0];
    for (let i = 1; i < vs.length; i++) if (vs[i].age > oldest.age) oldest = vs[i];
    oldest.kill();
    return oldest;
  }

  /**
   * Mono (#453): fade out every voice the part has sounding -- the same 4 ms
   * steal a full pool uses, so the cut never clicks -- and drop the note map
   * with them. Every remaining entry points at a voice that is fading or
   * already free, so a later noteOff for a cut note finds nothing and cannot
   * release the note that replaced it. Allocates nothing.
   */
  cutSounding() {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && !v.fading) v.steal();
    }
    this.noteMap.clear();
  }

  noteOn(msg) {
    const p = this.patch;
    const id = msg.id != null ? msg.id : msg.note;
    const vel = num(msg.velocity, 1);
    const mod = num(msg.mod, 0);
    const count = p.spread > 0 ? 2 : 1;
    const glideFrom = p.glide > 0 && this.lastNote != null ? this.lastNote : null;

    // One note at a time, with retrigger: the cut happens before the new note
    // allocates, so the fading voices are in reserve slots and the new note
    // starts fresh. `spread` still runs its detuned pair for the one note, and
    // `glide` still slides from `lastNote`.
    // A slide in mono (#602): the sounding voice takes the new note legato.
    if (msg.slide && p.mono && this.slideTo(id, msg.note, vel, mod)) return;
    if (p.mono) this.cutSounding();

    let list = this.noteMap.get(id);
    if (list) this.noteOffId(id);
    list = [];

    for (let u = 0; u < count; u++) {
      const v = this.allocate();
      const sign = u === 0 ? -1 : 1;
      const detune = count === 1 ? 0 : (sign * p.spread) / 100;
      let pan = p.pan + p.panKey * ((msg.note - 60) / 48) + p.panRandom * (this.random() * 2 - 1);
      if (count > 1) pan += sign * 0.35 * Math.min(1, p.spread / 50);
      v.start(p, this.waveSets, msg.note, vel, detune, pan, glideFrom, id);
      v.mod = mod;
      list.push(v);
    }
    this.noteMap.set(id, list);
    this.lastNote = msg.note;
  }

  /**
   * Retarget the held note's voices to `note` under handle `id` (#602). In
   * mono at most one handle is gated, so the first gated voice names it.
   * False when nothing is sounding: the caller starts a fresh voice instead.
   * Allocates nothing beyond the map's own bookkeeping, as `noteOn` does.
   */
  slideTo(id, note, velocity, mod) {
    const vs = this.voices;
    let heldId = null;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && v.gate && !v.fading) {
        heldId = v.voiceId;
        break;
      }
    }
    if (heldId === null || heldId === id) return false;
    const list = this.noteMap.get(heldId);
    if (!list) return false;
    const p = this.patch;
    const glide = p.glide > 0 ? p.glide : this.slideSeconds;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v.voiceId !== heldId) continue;
      v.retarget(note, velocity, mod, glide);
      v.voiceId = id;
    }
    this.noteMap.delete(heldId);
    this.noteMap.set(id, list);
    this.lastNote = note;
    return true;
  }

  noteOffId(id) {
    const list = this.noteMap.get(id);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      if (list[i].voiceId === id) this.releaseVoice(list[i]);
    }
    this.noteMap.delete(id);
  }

  /** Note-off for one voice: a dormant voice's release is silence, so it just ends (#547). */
  releaseVoice(v) {
    if (this.dormancy && v.active && v.dormant) v.kill();
    else v.release();
  }

  /**
   * The render. `renderBlock` is the whole of it; `process` is the sampler
   * wrapper (#445) and nothing else, so the hot loop reads exactly as it did
   * and a page that never turns the sampler on pays one branch per quantum.
   */
  process(inputs, outputs, params) {
    if (this.loadQuanta === 0) return this.renderBlock(inputs, outputs, params);
    const t0 = Date.now();
    const running = this.renderBlock(inputs, outputs, params);
    this.sampleLoad(t0, Date.now());
    return running;
  }

  renderBlock(inputs, outputs, params) {
    const out = outputs[0];
    if (!out || out.length === 0) return this.running;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];
    const n = outL.length;

    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    const bend = params.pitchBend[0];
    const mw = params.modWheel[0];
    const cm = params.cutoffMod[0];
    const gain = params.gain[0];

    const blockStart = currentFrame;
    const dormancy = this.dormancy;
    const q = this.events;
    let cursor = 0;

    while (cursor < n) {
      // Apply every event landing on this frame.
      while (q.length > 0 && q[0]._frame <= blockStart + cursor) {
        const ev = q.shift();
        if (ev.type === 'noteOn') this.noteOn(ev);
        else if (ev.type === 'noteOff') this.noteOffId(ev.id != null ? ev.id : ev.note);
      }

      // Render up to the next event, the next control boundary, or block end.
      let seg = n - cursor;
      if (q.length > 0) {
        const untilEvent = q[0]._frame - (blockStart + cursor);
        if (untilEvent > 0 && untilEvent < seg) seg = untilEvent;
      }

      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (!v.active) continue;

        let done = 0;
        while (done < seg) {
          // A dormant voice is skipped to the end of the segment and re-read at
          // the next one (#547); `ctrlCount` stays 0 so that check is a control
          // boundary. Age still runs, so stealing order holds.
          if (v.ctrlCount === 0 && dormancy && v.dormant) {
            v.age += seg - done;
            break;
          }
          if (v.ctrlCount === 0) {
            v.updateControl(CTRL_INTERVAL, bend, mw, cm);
            v.ctrlCount = CTRL_INTERVAL;
          }
          const chunk = Math.min(seg - done, v.ctrlCount);
          v.render(outL, outR, cursor + done, chunk);
          v.ctrlCount -= chunk;
          done += chunk;
        }

        if (!v.gate && !v.fading && v.finished) v.active = false;
      }

      cursor += seg;
    }

    if (gain !== 1) {
      for (let i = 0; i < n; i++) outL[i] *= gain;
      if (outR !== outL) for (let i = 0; i < n; i++) outR[i] *= gain;
    }

    return this.running;
  }
}

registerProcessor('fm-part', FmPartProcessor);
