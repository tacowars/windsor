/**
 * Every part's two lights, read from the part meter bank (windsor#528): the
 * one set of meters the part strip's chips and the Song mixer both show.
 * One per context, so a red latch is one per part, and a clear on a chip
 * puts out the mixer's light as well.
 *
 * The bank is `AudioSystem.partMeters` (windsor#540): one node metering
 * every part, which `MusicRoster` attaches each part to on its slot. While
 * audio is on it runs on every tab; the first read of a system switches its
 * bank on, and a rebuilt system brings a new bank, which drops the old
 * latches with it (`ClipLatches`). A read is cheap enough for every frame:
 * `BankLights` touches the bank only when its revision moved.
 *
 * The readers' loops are frame requests, which stop while the document is
 * hidden, and with no system there is nothing to read.
 */
import type { PartMeterBank } from '@windsor/engine';
import type { AppCtx } from './context';
import { BankLights } from './songMixerLightsModel';
import type { LightSource } from './songMixerLightsSource';

/** The part lights as both views read them: a `LightSource` keyed on part slots. */
export interface PartLights extends LightSource {
  /** Switch the live system's bank on and read it if it moved; a count that moves when a light changed. */
  sync(): number;
}

function createPartLights(ctx: AppCtx): PartLights {
  const lights = new BankLights<PartMeterBank>();
  let active: PartMeterBank | undefined;
  const sync = (): number => {
    const bank = ctx.host.system?.partMeters;
    if (bank !== active) {
      bank?.setActive(true);
      active = bank;
    }
    lights.update(bank, ctx.model.doc.parts);
    return lights.changes;
  };
  return {
    sync,
    // Every slot is read whichever rows are on screen: the bank meters them all.
    poll: sync,
    step: (slot) => lights.step(slot),
    lit: (slot) => lights.lit(slot),
    clear(slot) {
      lights.clear(slot);
      active?.reset(slot);
    },
    // The bank keeps running for the strip; nothing here is a view's to switch off.
    release() {},
    // A removed part's lights go when the part list changes (`BankLights.update`).
    retain() {},
  };
}

const byContext = new WeakMap<AppCtx, PartLights>();

/** The context's part lights, made on first use. */
export function partLights(ctx: AppCtx): PartLights {
  let lights = byContext.get(ctx);
  if (!lights) {
    lights = createPartLights(ctx);
    byContext.set(ctx, lights);
  }
  return lights;
}
