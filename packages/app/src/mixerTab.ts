/**
 * Mixer tab (#70, record §2): strips (level, pan, sends), returns and spaces.
 * Strip changes go through the document (`mix` overlay) and the live system;
 * return level and space changes drive the live return buses directly — the
 * document schema deliberately carries no returns section (#75 record,
 * punted until the console needs to author returns), so those are live-only.
 */
import type {
  ChannelStrip,
  MusicPartId,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  DEFAULT_STRIP,
  MIX,
  RETURNS,
  RETURN_NAMES,
  SPACES,
  SPACE_NAMES,
  makeSpace,
  stripFor,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { SLOT_IDS } from './context';
import { el, fmt2, fmtSigned, section, select } from './dom';
import { makeKnob } from './knob';

const STRIP_COLOR = '#5FA8A0';
const RETURN_COLOR = '#9C7BD0';

function stripValue(ctx: AppCtx, name: string): ChannelStrip {
  return ctx.model.doc.mix?.[name] ?? stripFor(MIX, name) ?? DEFAULT_STRIP;
}

function stripRow(ctx: AppCtx, id: MusicPartId, name: string): HTMLElement {
  const row = el('div', 'strip-row');
  row.appendChild(el('div', 'strip-name', `${name} <small>(${id})</small>`));
  const knobs = el('div', 'knob-row');
  knobs.appendChild(
    makeKnob({
      label: 'Level',
      min: 0,
      max: 2,
      def: 1,
      color: STRIP_COLOR,
      fmt: fmt2,
      get: () => stripValue(ctx, name).level,
      set: (v) => void ctx.change({ mix: { [name]: { level: v } } }),
    }),
  );
  knobs.appendChild(
    makeKnob({
      label: 'Pan',
      min: -1,
      max: 1,
      def: 0,
      color: STRIP_COLOR,
      fmt: fmtSigned,
      get: () => stripValue(ctx, name).pan,
      set: (v) => void ctx.change({ mix: { [name]: { pan: v } } }),
    }),
  );
  for (const ret of RETURN_NAMES) {
    knobs.appendChild(
      makeKnob({
        label: `→ ${ret}`,
        min: 0,
        max: 1,
        def: 0,
        color: RETURN_COLOR,
        fmt: fmt2,
        get: () => stripValue(ctx, name).sends[ret] ?? 0,
        set: (v) => void ctx.change({ mix: { [name]: { sends: { [ret]: v } } } }),
      }),
    );
  }
  row.appendChild(knobs);
  return row;
}

function returnRow(ctx: AppCtx, name: string): HTMLElement {
  const spec = RETURNS[name as keyof typeof RETURNS];
  const row = el('div', 'strip-row');
  row.appendChild(el('div', 'strip-name', `return: ${name} <small>(${spec.kind})</small>`));
  const knobs = el('div', 'knob-row');
  knobs.appendChild(
    makeKnob({
      label: 'Level',
      min: 0,
      max: 1,
      def: spec.level,
      color: RETURN_COLOR,
      fmt: fmt2,
      get: () => ctx.host.system?.returnBus(name)?.level.value ?? spec.level,
      set: (v) => {
        const bus = ctx.host.system?.returnBus(name);
        if (bus) bus.level.value = v;
      },
    }),
  );
  if (spec.kind === 'delay') {
    knobs.appendChild(
      makeKnob({
        label: 'Time',
        min: 0.05,
        max: 1.5,
        def: spec.delayTime,
        color: RETURN_COLOR,
        fmt: (v) => `${(v * 1000).toFixed(0)}m`,
        get: () => {
          const effect = ctx.host.system?.returnBus(name)?.effect;
          return effect instanceof DelayNode ? effect.delayTime.value : spec.delayTime;
        },
        set: (v) => {
          const effect = ctx.host.system?.returnBus(name)?.effect;
          if (effect instanceof DelayNode) effect.delayTime.value = v;
        },
      }),
    );
  } else {
    row.appendChild(spacePicker(ctx, name));
  }
  row.appendChild(knobs);
  return row;
}

/** Swap the plate's space live: every space param onto the worklet's AudioParams. */
function spacePicker(ctx: AppCtx, name: string): HTMLElement {
  let current = 'hall';
  return select(
    'Space',
    SPACE_NAMES.map((key) => ({ value: key, label: key })),
    current,
    (key) => {
      current = key;
      const effect = ctx.host.system?.returnBus(name)?.effect;
      if (!effect || effect instanceof DelayNode) return;
      const space = makeSpace(SPACES[key as keyof typeof SPACES]);
      for (const [param, value] of Object.entries(space)) {
        const target = effect.parameters.get(param);
        if (target) target.value = value;
      }
      ctx.status(`return "${name}" space → ${key} (live only)`);
    },
  );
}

export function renderMixerTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  const strips = section('Strips', 'Levels, pans and sends land in the document (mix overlay).');
  for (const id of SLOT_IDS) {
    const slot = ctx.model.doc[id];
    if (slot) strips.body.appendChild(stripRow(ctx, id, slot.part));
  }
  body.appendChild(strips.root);
  const returns = section(
    'Returns & spaces',
    'Live only — returns are code-owned (packages/client/src/audio/mix.ts); the document schema carries no returns section.',
  );
  for (const name of RETURN_NAMES) returns.body.appendChild(returnRow(ctx, name));
  body.appendChild(returns.root);
}
