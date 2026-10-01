/* eslint-disable no-magic-numbers -- DSP: the parameter ranges, the reserve of four voices, the pan spread and the 128-frame budget are the part's contract; the tunables are fmConstants.ts (#654) */
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

import type {
  NoteOnMessage,
  ProcessorOptions,
  ScheduledMessage,
  WorkletMessage,
} from '../../synth/workletMessages';
import type { QueuedEvent } from './eventQueue';
import type { WorkletPatch } from './patchNormalise';
import { EventQueue } from './eventQueue';
import { CTRL_INTERVAL } from './fmConstants';
import { normalisePatch, num } from './patchNormalise';
import { makeRandom } from './prng';
import { LoadSampler } from '../loadSampler';
import { Voice } from './voice';
import { PART_BEND, PART_CONTROL_COUNT, PART_CUTOFF_MOD, PART_WHEEL } from './voiceControl';
import { WAVE } from './waveIds';
import { getMips } from './waveTables';

/** `processorOptions` as the part reads them: the contract's, plus the two harness-only switches (#547, #548). */
interface FmProcessorOptions extends Partial<ProcessorOptions> {
  dormancy?: boolean;
  specialise?: boolean;
}

/* ------------------------------------------------------------------ *
 * The processor — one timbral part
 * ------------------------------------------------------------------ */

class FmPartProcessor extends AudioWorkletProcessor {
  maxVoices: number;
  random: () => number;
  voices: Voice[];
  patch: WorkletPatch;
  waveSets: (Float32Array[] | null)[];
  events: EventQueue;
  partControls: Float64Array;
  lastNote: number;
  running: boolean;
  liveRetune: boolean;
  slideSeconds: number;
  dormancy: boolean;
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'pitchBend', defaultValue: 0, minValue: -48, maxValue: 48, automationRate: 'k-rate' },
      { name: 'modWheel', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'cutoffMod', defaultValue: 0, minValue: -8, maxValue: 8, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const opts: FmProcessorOptions = (options && options.processorOptions) || {};
    const maxVoices = Math.max(1, Math.min(128, opts.maxVoices || 16));
    this.maxVoices = maxVoices;

    // One random source for the whole part. Absent `seed` this is Math.random,
    // which is what live playback gets; see "Randomness" in `prng.ts`.
    this.random = makeRandom(opts.seed);

    // Rule 7: each double field is born a double (NaN), before its start value (windsor#233).
    this.lastNote = this.slideSeconds = NaN;

    // The k-rate parameters for this quantum, one slot each (`PART_BEND`, …):
    // `renderBlock` writes them, and every voice's control update reads them,
    // so no double is passed to a call (windsor#233).
    this.partControls = new Float64Array(PART_CONTROL_COUNT);

    // Four reserve slots above the sounding limit so a stolen voice can fade
    // out while its replacement is already sounding.
    const poolSize = maxVoices + 4;
    this.voices = new Array(poolSize);
    for (let i = 0; i < poolSize; i++) {
      this.voices[i] = new Voice(sampleRate, this.random, this.partControls);
    }

    this.patch = normalisePatch(opts.patch);
    this.waveSets = [null, null, null, null];
    this.rebuildWaves();

    this.events = new EventQueue(); // frame-stamped, kept sorted
    // The note map is each voice's `keyed` flag and `voiceId` (windsor#233):
    // a `Map` of lists allocated a list per note and grew its table.
    this.lastNote = NaN; // for legato glide; NaN until the first note
    this.running = true;
    // Off by default; the console turns it on so a knob retunes ringing voices.
    this.liveRetune = false;
    // Seconds a slid note glides when the patch's `glide` is 0 (#602).
    this.slideSeconds = num(opts.slideSeconds, 0);
    // Skipping silent held voices (#547). Always on in live playback;
    // `dormancy: false` exists so a test can render the same part without it and
    // prove the two renders agree.
    this.dormancy = opts.dormancy !== false;
    // The fixed-index voice kernel and per-note constants (#548), always on in
    // live playback; `specialise: false` renders every voice through the
    // generic loop, so a test can prove the two agree bit for bit.
    const specialise = opts.specialise !== false;
    for (let i = 0; i < poolSize; i++) this.voices[i].specialise = specialise;

    // Audio-load sampler (#445, `../loadSampler.ts`), off until a `reportLoad`
    // message turns it on, so an offline render and the Node harness time
    // nothing and post nothing. See workletMessages.ts for why this counts
    // millisecond boundaries rather than timing the call.
    this.load = new LoadSampler(sampleRate, this.port);

    // Events supplied at construction. port.postMessage() is delivered
    // asynchronously and can lose the race against OfflineAudioContext's
    // startRendering(), so offline renders must pass their notes this way.
    if (Array.isArray(opts.events)) {
      for (const ev of opts.events) this.schedule(ev);
    }

    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => this.onMessage(e.data);
  }

  rebuildWaves(): void {
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

  onMessage(msg: WorkletMessage): void {
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
        this.schedule(msg);
        break;
      case 'noteOff':
        this.schedule(msg);
        break;
      case 'allNotesOff':
        // Queued future events are cancelled too: a mute or a live rebuild
        // (#69) must not let the scheduler's look-ahead keep sounding. Unlike
        // panic, voices already sounding still release with their tails.
        for (const v of this.voices) this.releaseVoice(v);
        this.unkeyAll();
        this.events.clear();
        break;
      case 'panic':
        for (const v of this.voices) v.kill();
        this.unkeyAll();
        this.events.clear();
        break;
      case 'stop':
        this.running = false;
        break;
      case 'reportLoad':
        // #445: start (or restart) the duty-cycle sampler.
        this.load.start(msg.quanta);
        break;
    }
  }

  /**
   * Queue `ev` at its frame, or now without one. The frame is read here, not
   * passed in: past 2^31 it is a double, which an argument can box (rule 7).
   */
  schedule(ev: ScheduledMessage): void {
    const queued = ev as QueuedEvent;
    queued._frame = typeof ev.frame === 'number' ? ev.frame : currentFrame;
    this.events.insert(queued);
  }

  /** Drop every voice from the note map: a later note-off for any of them finds nothing. */
  unkeyAll(): void {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) vs[i].keyed = false;
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
  allocate(): Voice {
    const vs = this.voices;
    let free: Voice | null = null;
    let sounding = 0;
    let bestDormant: Voice | null = null,
      bestDormantAge = -1;
    let bestReleased: Voice | null = null,
      bestReleasedAge = -1;
    let bestAny: Voice | null = null,
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
   * with them, so a later noteOff for a cut note finds nothing and cannot
   * release the note that replaced it. Allocates nothing.
   */
  cutSounding(): void {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && !v.fading) v.steal();
    }
    this.unkeyAll();
  }

  noteOn(msg: NoteOnMessage): void {
    const p = this.patch;
    const id = msg.id != null ? msg.id : msg.note;
    const vel = num(msg.velocity, 1);
    const mod = num(msg.mod, 0);
    const count = p.spread > 0 ? 2 : 1;
    // Where a glide starts: the last note, NaN for none (`lastNote` is NaN until the first).
    const glideFrom = p.glide > 0 ? this.lastNote : NaN;

    // One note at a time, with retrigger: the cut happens before the new note
    // allocates, so the fading voices are in reserve slots and the new note
    // starts fresh. `spread` still runs its detuned pair for the one note, and
    // `glide` still slides from `lastNote`.
    // A slide in mono (#602): the sounding voice takes the new note legato.
    if (msg.slide && p.mono && this.slideTo(id, msg, vel, mod)) return;
    if (p.mono) this.cutSounding();

    // A handle already held is released first, as a new note under it.
    this.noteOffId(id);

    for (let u = 0; u < count; u++) {
      const v = this.allocate();
      const sign = u === 0 ? -1 : 1;
      const detune = count === 1 ? 0 : (sign * p.spread) / 100;
      let pan = p.pan + p.panKey * ((msg.note - 60) / 48) + p.panRandom * (this.random() * 2 - 1);
      if (count > 1) {
        // `Math.min(1, spread / 50)`, NaN and -0 alike, with no builtin call.
        const width = p.spread / 50;
        pan += sign * 0.35 * (width > 1 ? 1 : width);
      }
      // The note's doubles go to the voice in its fields, not as arguments (windsor#233).
      v.velocity = vel;
      v.detune = detune;
      v.pan = pan;
      v.glideFrom = glideFrom;
      v.start(p, this.waveSets, msg.note, id, msg.stepMod);
      v.mod = mod;
      v.keyed = true;
    }
    this.lastNote = msg.note;
  }

  /**
   * Retarget the held note's voices to the message's note and step offsets
   * (windsor#17) under handle `id` (#602). In mono at most one handle is
   * gated, so the first gated voice names it. False when nothing is
   * sounding: the caller starts a fresh voice instead. The slide takes the
   * handle `id` over: a voice still keyed to it leaves the note map without a
   * release, as it did when the map was a `Map` whose entry for `id` the
   * slide replaced. Allocates nothing.
   */
  slideTo(id: number, msg: NoteOnMessage, velocity: number, mod: number): boolean {
    const note = msg.note;
    const vs = this.voices;
    let heldId: number | null = null;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.active && v.gate && !v.fading) {
        heldId = v.voiceId;
        break;
      }
    }
    if (heldId === null || heldId === id || !this.isKeyed(heldId)) return false;
    const p = this.patch;
    const glide = p.glide > 0 ? p.glide : this.slideSeconds;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.keyed && v.voiceId === id) v.keyed = false;
    }
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (!v.keyed || v.voiceId !== heldId) continue;
      v.retarget(note, velocity, mod, glide, msg.stepMod);
      v.voiceId = id;
    }
    this.lastNote = note;
    return true;
  }

  /** Whether the note map holds any voice under handle `id`. */
  isKeyed(id: number): boolean {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) if (vs[i].keyed && vs[i].voiceId === id) return true;
    return false;
  }

  /** Release every voice the note map holds under handle `id`, and drop them from it. */
  noteOffId(id: number): void {
    const vs = this.voices;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (!v.keyed || v.voiceId !== id) continue;
      v.keyed = false;
      this.releaseVoice(v);
    }
  }

  /** Note-off for one voice: a dormant voice's release is silence, so it just ends (#547). */
  releaseVoice(v: Voice): void {
    if (this.dormancy && v.active && v.dormant) v.kill();
    else v.release();
  }

  /**
   * The render. `renderBlock` is the whole of it; `process` is the sampler
   * wrapper (#445) and nothing else, so the hot loop reads exactly as it did
   * and a page that never turns the sampler on pays one branch per quantum.
   */
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean {
    const load = this.load;
    if (load.quanta === 0) return this.renderBlock(inputs, outputs, params);
    load.begin();
    const running = this.renderBlock(inputs, outputs, params);
    load.end(128);
    return running;
  }

  /**
   * This quantum's bend, wheel and cutoff into `partControls`, where every
   * voice's control update reads them. Passed to the update as arguments,
   * each was a new heap number wherever V8 did not inline it (windsor#233).
   */
  latchControls(params: Record<string, Float32Array>): void {
    const controls = this.partControls;
    controls[PART_BEND] = params.pitchBend[0];
    controls[PART_WHEEL] = params.modWheel[0];
    controls[PART_CUTOFF_MOD] = params.cutoffMod[0];
  }

  renderBlock(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return this.running;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];
    const n = outL.length;

    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    this.latchControls(params);
    const gain = params.gain[0];

    const blockStart = currentFrame;
    const dormancy = this.dormancy;
    const q = this.events;
    let cursor = 0;

    while (cursor < n) {
      // Apply every event landing on this frame.
      // The next event's frame is read in place, never returned from a call:
      // past 2^31 it is a double, which a return can box (rule 7).
      while (!q.empty && q.items[q.head]._frame <= blockStart + cursor) {
        const ev = q.take();
        if (ev.type === 'noteOn') this.noteOn(ev);
        else if (ev.type === 'noteOff') this.noteOffId(ev.id != null ? ev.id : ev.note!);
      }

      // Render up to the next event, the next control boundary, or block end.
      let seg = n - cursor;
      if (!q.empty) {
        const untilEvent = q.items[q.head]._frame - (blockStart + cursor);
        // In (0, seg), so `| 0` is exact; it keeps `seg` a small integer when
        // the frames are doubles (past 2^31), and `voice.age` with it.
        if (untilEvent > 0 && untilEvent < seg) seg = untilEvent | 0;
      }

      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (!v.active) continue;

        let done = 0;
        while (done < seg) {
          // A steal fade that ends inside the segment kills the voice (and
          // `kill` resets `fade` to 1): rendering on would bring the filter's
          // ring back at full level, then cut it at the segment end (windsor#7).
          if (!v.active) break;
          // A dormant voice is skipped to the end of the segment and re-read at
          // the next one (#547); `ctrlCount` stays 0 so that check is a control
          // boundary. Age still runs, so stealing order holds.
          if (v.ctrlCount === 0 && dormancy && v.dormant) {
            v.age += seg - done;
            break;
          }
          if (v.ctrlCount === 0) {
            v.updateControl(CTRL_INTERVAL);
            v.ctrlCount = CTRL_INTERVAL;
          }
          const chunk = Math.min(seg - done, v.ctrlCount);
          v.render(outL, outR, cursor + done, chunk);
          v.ctrlCount -= chunk;
          done += chunk;
        }

        v.settle();
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
