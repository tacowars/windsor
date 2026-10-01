/**
 * The Mixer tab's Groups section (windsor#287; record `2026-10-01-group-buses`
 * decisions 2, 3, 6, 7 and 10): one row per group in the song's list, laid
 * out as a send bus row (`returnsPanel.ts`, `.bus-line`), and Add group
 * under the last. A row's head holds the name as a text field, Level and Pan,
 * M and S, the activity and clip lights, the members line and Remove; beside
 * it is the group's insert chain, drawn by `stripInserts` in the row's own
 * accent (`consoleColors.ts`'s `groupAccent`).
 *
 * The rules are `groupModel.ts`'s: every edit is one `ctx.change`, one undo
 * step, applied live to `AudioSystem.groupBus(id)`. The lights are the Song
 * tab's poller (`songMixerLights.ts`) keyed on group ids over each group
 * bus's meter: one for the section, kept across renders so a clip stays
 * latched until it is clicked, and active only while a row is on screen in
 * the shown tab.
 */
import type { GroupSpec } from '@windsor/engine';
import { groupAccent } from './consoleColors';
import type { AppCtx } from './context';
import { el, section } from './dom';
import type { GroupSwitch } from './groupModel';
import {
  GROUPS_FULL_TITLE,
  addGroup,
  canAddGroup,
  groupAt,
  groupKey,
  groupMembers,
  groupSwitchLabel,
  groupSwitchOn,
  groupsOf,
  membersLine,
  removeGroup,
  renameGroup,
  toggleGroupSwitch,
} from './groupModel';
import { makeKnob } from './knob';
import { GROUP_LEVEL_KNOB, GROUP_PAN_KNOB } from './mixerTables';
import type { LightMeters, MixerLights } from './songMixerLights';
import { songMixerLights } from './songMixerLights';
import { stripInserts } from './stripInserts';

const GROUPS_HINT =
  "A part whose Output is a group plays through it. The group's inserts, pan and level process " +
  "its parts together before the master. Each part's sends still go straight to Send A and Send B.";

/** The letter each switch shows, as on a part's strip. */
const SWITCH_TEXT: Readonly<Record<GroupSwitch, string>> = { mute: 'M', solo: 'S' };

/** A group bus's post-gate meter, by id. */
const groupMeters: LightMeters = (ctx, id) => ctx.host.system?.groupBus(id)?.meter;

/** The section's one lights poller, made once per context so its latches outlive a render. */
let lights: { readonly ctx: AppCtx; readonly poller: MixerLights } | null = null;

function groupLights(ctx: AppCtx): MixerLights {
  if (lights?.ctx !== ctx) lights = { ctx, poller: songMixerLights(ctx, groupMeters) };
  return lights.poller;
}

/** The group's name: commits on Enter or blur as one step; an empty or unchanged name reverts. */
function nameField(ctx: AppCtx, group: GroupSpec): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field group-name';
  input.name = `group-name-${group.id}`;
  input.value = group.name;
  input.setAttribute('aria-label', 'Group name');
  input.onkeydown = (e): void => {
    if (e.key === 'Escape') input.value = groupAt(ctx.model.doc, group.id)?.name ?? group.name;
    if (e.key === 'Enter' || e.key === 'Escape') input.blur();
  };
  input.onblur = (): void => {
    if (renameGroup(ctx, group.id, input.value)) ctx.render();
    else input.value = groupAt(ctx.model.doc, group.id)?.name ?? group.name;
  };
  return input;
}

/** Level and Pan, writing the group's fields live and into the document. */
function groupKnobs(ctx: AppCtx, group: GroupSpec, color: string): HTMLElement {
  const { id } = group;
  const now = (): GroupSpec | undefined => groupAt(ctx.model.doc, id);
  const knobs = el('div', 'group-knobs');
  knobs.append(
    makeKnob({
      ...GROUP_LEVEL_KNOB,
      color,
      dial: 'rack',
      get: () => now()?.level ?? GROUP_LEVEL_KNOB.def,
      set: (level) => void ctx.change({ groups: { [id]: { level } } }),
    }),
    makeKnob({
      ...GROUP_PAN_KNOB,
      color,
      dial: 'rack',
      get: () => now()?.pan ?? GROUP_PAN_KNOB.def,
      set: (pan) => void ctx.change({ groups: { [id]: { pan } } }),
    }),
  );
  return knobs;
}

/** An M or S button over the group, pressed while the switch is on. */
function switchButton(ctx: AppCtx, group: GroupSpec, which: GroupSwitch): HTMLButtonElement {
  const button = el('button', `btn mix-btn ${which}`, SWITCH_TEXT[which]) as HTMLButtonElement;
  button.type = 'button';
  const sync = (): void => {
    const now = groupAt(ctx.model.doc, group.id) ?? group;
    const label = groupSwitchLabel(which, now.name);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', String(groupSwitchOn(now, which)));
  };
  button.onclick = (): void => {
    if (toggleGroupSwitch(ctx, group.id, which)) ctx.invalidate();
    sync();
  };
  sync();
  return button;
}

/** M, S and the lights, on one line. */
function switchLine(ctx: AppCtx, group: GroupSpec): HTMLElement {
  const line = el('div', 'group-switches');
  const switches = el('div', 'mix-switches');
  switches.append(switchButton(ctx, group, 'mute'), switchButton(ctx, group, 'solo'));
  line.append(switches, groupLights(ctx).lightsFor(group.id, group.name));
  return line;
}

function removeButton(ctx: AppCtx, group: GroupSpec): HTMLButtonElement {
  const button = el('button', 'btn group-remove', 'Remove') as HTMLButtonElement;
  button.type = 'button';
  button.title = `Remove ${group.name}; its parts play to Master`;
  button.setAttribute('aria-label', `Remove ${group.name}`);
  button.onclick = (): void => {
    if (removeGroup(ctx, group.id)) ctx.render();
  };
  return button;
}

function groupHead(ctx: AppCtx, group: GroupSpec, color: string): HTMLElement {
  const head = el('div', 'bus-head group-head');
  head.append(
    nameField(ctx, group),
    groupKnobs(ctx, group, color),
    switchLine(ctx, group),
    el('div', 'bus-sub', membersLine(groupMembers(ctx.model.doc, group.id))),
    removeButton(ctx, group),
  );
  return head;
}

function groupRow(ctx: AppCtx, group: GroupSpec, index: number): HTMLElement {
  const color = groupAccent(index);
  const row = el('div', 'bus-line group-line');
  row.style.setProperty('--group-accent', color);
  const rack = stripInserts(ctx, groupKey(group.id), 'bus');
  rack.style.setProperty('--kc', color);
  row.append(groupHead(ctx, group, color), rack);
  return row;
}

function addButton(ctx: AppCtx): HTMLButtonElement {
  const full = !canAddGroup(ctx.model.doc);
  const button = el('button', 'btn group-add', 'Add group') as HTMLButtonElement;
  button.type = 'button';
  button.disabled = full;
  button.title = full ? GROUPS_FULL_TITLE : 'Add a group bus at the end of the list';
  button.onclick = (): void => {
    if (addGroup(ctx)) ctx.render();
  };
  return button;
}

export function renderGroupsSection(ctx: AppCtx): HTMLElement {
  const groups = section('Groups', GROUPS_HINT);
  groupsOf(ctx.model.doc).forEach((group, index) => {
    groups.body.appendChild(groupRow(ctx, group, index));
  });
  groups.body.appendChild(addButton(ctx));
  return groups.root;
}
