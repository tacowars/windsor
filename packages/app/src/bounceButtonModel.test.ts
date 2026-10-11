/** Where the pane shows Bounce to Roll, and how (windsor#742, record `2026-10-11-bounce-to-roll` decision 1). */
import { describe, expect, it } from 'vitest';

import type { MusicPart } from '@windsor/engine';
import { SEQUENCER_KINDS } from '@windsor/engine';
import { BOUNCE_KINDS as ENGINE_BOUNCE_KINDS } from '@windsor/engine/song/bounceRenderTables';
import { bounceButtonState } from './bounceButtonModel';
import { BOUNCE_KINDS } from './bounceTables';

const part = (kind: string, regions: number): Pick<MusicPart, 'sequencer' | 'regions'> =>
  ({
    sequencer: { kind },
    regions: Array.from({ length: regions }, () => ({ start: 0, duration: 96 })),
  }) as unknown as Pick<MusicPart, 'sequencer' | 'regions'>;

describe('the Bounce to Roll button', () => {
  it('shows on exactly the kinds the engine bounces', () => {
    expect(BOUNCE_KINDS).toEqual(ENGINE_BOUNCE_KINDS);
    const shown = SEQUENCER_KINDS.filter((kind) => bounceButtonState(part(kind, 1)) !== null);
    expect(shown).toEqual(['euclidean', 'grid', 'chord', 'arp', 'bass', 'figure']);
  });

  it('is enabled on a part with regions and disabled, with its reason, on one with none', () => {
    expect(bounceButtonState(part('grid', 2))).toEqual({
      disabled: false,
      title: 'Rewrite every region of this part as a Roll of the notes it plays. One undo step.',
    });
    expect(bounceButtonState(part('grid', 0))).toEqual({
      disabled: true,
      title: 'No regions to bounce',
    });
  });
});
