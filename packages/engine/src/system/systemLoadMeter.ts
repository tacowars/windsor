/**
 * The system's load meter (#445): one `AudioLoadMeter`, and whether this
 * system turns the sampler on at all (windsor#51 decision 6). The live system
 * meters every part, return, worklet insert and the output stage; the offline
 * song render meters nothing, since no processor's timing means anything while
 * an export runs. `cost/audioLoad.ts` owns the sampling rules; this owns only
 * which processors report into the sum.
 */
import { AUDIO_LOAD_REPORT_SECONDS } from '../audioConstants';
import type { AudioLoadReadout } from '../cost/audioLoad';
import { AudioLoadMeter, meterNode } from '../cost/audioLoad';
import type { InsertRegistry } from '../inserts/insertRegistry';
import { meteredInsertRegistry } from '../inserts/meteredInsertRegistry';

export class SystemLoadMeter {
  private readonly meter = new AudioLoadMeter();

  /**
   * `context` supplies the sample rate each processor reports at; `enabled`
   * false turns every `attach` and the insert registry's metering off.
   */
  constructor(
    private readonly context: BaseAudioContext,
    private readonly enabled: boolean,
  ) {}

  /** Processors this system has turned load reporting on in. */
  get processorCount(): number {
    return this.meter.processorCount;
  }

  /**
   * The insert registry the strips build from: `source` with every worklet
   * insert on the meter for exactly its lifetime, or `source` itself when
   * this system does not meter.
   */
  registry(source: InsertRegistry): InsertRegistry {
    return this.enabled ? meteredInsertRegistry(this.meter, source) : source;
  }

  /** Turn the sampler on in one node's processor, under `id`. A node without a processor is skipped. */
  attach(id: string, node: AudioNode | undefined): void {
    if (!this.enabled || !node) return;
    meterNode(this.meter, id, node, this.context.sampleRate, AUDIO_LOAD_REPORT_SECONDS);
  }

  /** Stop counting `id`: its processor is gone. */
  detach(id: string): void {
    this.meter.detach(id);
  }

  readout(): AudioLoadReadout {
    return this.meter.readout();
  }

  dispose(): void {
    this.meter.dispose();
  }
}
