/** Routing transaction lifetime, kept separate from transport and patch application. */
import type { PartStrip } from './channelStrip';
import type { MasterStrip } from './masterStrip';
import type { ArrangementDocument, DocumentPartial } from '../song/arrangementDocument';
import { documentSidechains, invalidSidechains, type SidechainGraph } from './sidechainGraph';
import { planSidechains } from './sidechainPlan';
import { SidechainRouter } from './sidechainRouter';
export class SidechainDesk {
  private desired: SidechainGraph = new Map([['master', []]]);
  private readonly router: SidechainRouter;
  constructor(
    private readonly tracks: () => ReadonlyMap<number, PartStrip>,
    private readonly master: () => MasterStrip | null,
  ) {
    this.router = new SidechainRouter(tracks, master);
  }
  check(document: ArrangementDocument): SidechainGraph {
    const graph = documentSidechains(document);
    const invalid = invalidSidechains(graph);
    if (invalid.length) throw new Error(`${invalid[0]!.path}: ${invalid[0]!.reason}`);
    return graph;
  }
  plan(partial: DocumentPartial): ReturnType<typeof planSidechains> {
    return planSidechains(this.desired, partial);
  }
  begin(): void {
    this.router.begin();
  }
  cancel(): void {
    this.router.commit(this.desired);
  }
  commit(next: SidechainGraph): void {
    const tracks = this.tracks();
    for (const [target, specs] of next) {
      if (specs === this.desired.get(target)) continue;
      if (target === 'master') this.master()?.apply({ inserts: specs });
      else tracks.get(target)?.setInserts(specs);
    }
    this.desired = next;
    this.router.commit(next);
  }
  changed(): void {
    this.router.reconcile();
  }
  dispose(): void {
    this.router.dispose();
  }
}
