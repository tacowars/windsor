/** Mixer-owned detector fanout. Desired lists and actual lists differ during insert fades. */
import type { PartStrip } from './channelStrip';
import type { MasterStrip } from './masterStrip';
import {
  invalidSidechains,
  sidechainSlot,
  type InsertTarget,
  type SidechainGraph,
} from './sidechainGraph';
export class SidechainRouter {
  private edges: Array<{ source: AudioNode; input: AudioNode }> = [];
  private desired: SidechainGraph = new Map();
  private suspended = false;
  constructor(
    private readonly tracks: () => ReadonlyMap<number, PartStrip>,
    private readonly master: () => MasterStrip | null,
  ) {}
  /** Disconnect before a transaction can dispose a source. */
  begin(): void {
    this.suspended = true;
    this.disconnect();
  }
  commit(desired: SidechainGraph): void {
    this.desired = desired;
    this.suspended = false;
    this.reconcile();
  }
  private disconnect(): void {
    for (const { source, input } of this.edges) source.disconnect(input);
    this.edges = [];
  }
  reconcile(): void {
    if (this.suspended) return;
    this.disconnect();
    const tracks = this.tracks();
    const targets = new Map<InsertTarget, PartStrip | MasterStrip>(tracks);
    const master = this.master();
    if (master) targets.set('master', master);
    const actual = new Map([...targets].map(([id, strip]) => [id, strip.insertSpecs]));
    const invalid = invalidSidechains(actual);
    for (const [target, strip] of targets)
      strip.inserts.forEach((stage, index) => {
        if (!stage.detector) return;
        const spec = strip.insertSpecs[index];
        const external =
          spec?.kind === 'compressor' &&
          spec.sidechain !== undefined &&
          spec.sidechain !== 'internal';
        stage.detector.setExternal(external);
        if (!external || invalid.some((item) => item.target === target && item.index === index))
          return;
        const source = sidechainSlot(spec);
        // A deleted source or an old list waiting out a fade cannot reattach by slot reuse.
        if (source === null || source !== sidechainSlot(this.desired.get(target)?.[index])) return;
        const head = tracks.get(source)?.head;
        if (!head) return;
        head.connect(stage.detector.input);
        this.edges.push({ source: head, input: stage.detector.input });
      });
  }
  dispose(): void {
    this.begin();
    this.desired = new Map();
  }
}
