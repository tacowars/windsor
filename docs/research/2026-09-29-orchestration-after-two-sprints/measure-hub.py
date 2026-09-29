#!/usr/bin/env python3
"""Where the Claude allowance went in Windsor's first two sprints of parallel work.

Stdlib only. Reads the Claude Code transcripts for this repo under
~/.claude/projects/-Users-arrakis-code-windsor/ (main sessions as
<uuid>.jsonl, sub-agents as <uuid>/subagents/agent-<id>.jsonl + .meta.json;
schema notes in ../2026-09-28-agent-orchestration-overhead/measure-overhead.py)
and prints a markdown report. Nothing is estimated: every figure is summed
from the records.

"Tokens" here means input-side context per API call: input_tokens +
cache_read_input_tokens + cache_creation_input_tokens, deduplicated by
message.id (the transcript stores one record per content block). On a Max
subscription cache reads draw on the allowance, so this is the quantity that
matters. Output tokens are not measurable per record (see the 09-28 script).

Records after --until are ignored, so the report can be reproduced while
sessions keep writing. Usage:

    python3 measure-hub.py [--until 2026-09-29T09:22:00Z] > hub-report.md
"""

import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime

PROJECT = os.path.expanduser("~/.claude/projects/-Users-arrakis-code-windsor")
UNTIL = "2026-09-29T09:22:00Z"
BIG_CONTEXT = 150_000

# A worker is a sub-agent that worked an issue or a PR round. The first
# waves used general-purpose agents with a worker prompt, before the
# profiles in .claude/agents/ existed.
WORKER_TYPES = {"worker", "worker-light"}
WORKER_PROMPT = re.compile(
    r"^(You are a worker|Work Windsor issue|The issue is windsor#|Fix round|Round \d+ on PR|A repo-wide)"
)
FRESH_FIX_PROMPT = re.compile(r"^(Round \d+ on PR|Fix round)")


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def text_of(content):
    if isinstance(content, str):
        return content
    return " ".join(b.get("text", "") for b in content if b.get("type") == "text")


def has_tool_result(content):
    return isinstance(content, list) and any(b.get("type") == "tool_result" for b in content)


def records(path, until):
    with open(path) as fh:
        for line in fh:
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("timestamp") and ts(r["timestamp"]) > until:
                return
            yield r


def api_calls(path, until, sidechain=False):
    """Yield (record, context_tokens) once per API call.

    The transcript splits one API response into a record per content block,
    all with the same message.id and usage. The yielded record carries the
    blocks of every record of that call, so its tool_use blocks are complete.
    """
    calls = {}
    for r in records(path, until):
        if r.get("type") != "assistant" or bool(r.get("isSidechain")) != sidechain:
            continue
        mid = r["message"].get("id")
        if mid in calls:
            calls[mid]["message"]["content"] = calls[mid]["message"]["content"] + r["message"]["content"]
            continue
        calls[mid] = {**r, "message": {**r["message"], "content": list(r["message"]["content"])}}
    for r in calls.values():
        u = r["message"].get("usage", {})
        yield r, u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get(
            "cache_creation_input_tokens", 0
        )


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else 0


def p90(xs):
    xs = sorted(xs)
    return xs[int(len(xs) * 0.9)] if xs else 0


def m(n):
    return f"{n / 1e6:.1f}M"


def k(n):
    return f"{n / 1e3:.0f}k"


def trigger(r):
    """What started the main-session turn that follows this record, or None."""
    c = r["message"]["content"]
    if has_tool_result(c):
        return None
    s = text_of(c)
    if "Subagent hand-back" in s:
        return "worker hand-back"
    if "<task-notification>" in s:
        summ = re.search(r"<summary>(.*?)</summary>", s, re.S)
        summ = summ.group(1) if summ else ""
        if summ.startswith("Agent"):
            return "agent finished"
        return "Monitor / background wait (CI, Codex)"
    if r.get("isMeta") or s.startswith("<system-reminder>"):
        return None
    return "tacowars"


def main_tool_kind(block):
    n = block["name"]
    if n.startswith(("mcp__chrome-devtools", "mcp__claude-in-chrome")):
        return "browser"
    if n != "Bash":
        return n
    c = block["input"].get("command", "")
    if re.search(r"\bgh\b", c):
        return "Bash: gh"
    if re.search(r"\bgit\b", c):
        return "Bash: git"
    if re.search(r"vitest|npm|npx|node ", c):
        return "Bash: tests, build, node"
    return "Bash: shell read or edit"


def worker_result_kind(name, cmd):
    if name != "Bash":
        return "browser" if name.startswith("mcp__") else name
    if re.search(r"\bgh (issue|pr) view", cmd):
        return "gh issue/pr view"
    if re.search(r"\bgh\b", cmd):
        return "gh other"
    if re.search(r"vitest|npm (run )?test", cmd):
        return "vitest"
    if re.search(r"tsc|typecheck|eslint|lint", cmd):
        return "typecheck, lint"
    if re.search(r"python3? ?-? ?<<|python3 -c", cmd):
        return "python inline"
    if re.search(r"^\s*(cd [^;&]+&&\s*)?(sed -n|cat|head|tail|nl)\b", cmd):
        return "sed, cat, head"
    if re.search(r"\b(grep|rg|find|ls)\b", cmd):
        return "grep, find, ls"
    if re.search(r"\bgit\b", cmd):
        return "git"
    return "Bash other"


def main_sessions(until):
    return sorted(
        f
        for f in glob.glob(os.path.join(PROJECT, "*.jsonl"))
        if next(iter(records(f, until)), None) is not None
    )


def sub_agents(session):
    out = []
    for f in sorted(glob.glob(os.path.join(session[: -len(".jsonl")], "subagents", "agent-*.jsonl"))):
        meta = json.load(open(f[: -len(".jsonl")] + ".meta.json"))
        first = next((r for r in records(f, UNTIL_DT) if r.get("type") == "user"), None)
        if first is None:
            continue
        prompt = text_of(first["message"]["content"]).lstrip()
        worker = meta.get("agentType") in WORKER_TYPES or bool(WORKER_PROMPT.match(prompt))
        out.append((f, meta, prompt, worker))
    return out


def report_main(sessions, W):
    W("## Main sessions\n")
    W(f"Context per API call. \"Above {k(BIG_CONTEXT)}\" sums, over every call, the part of its context past {k(BIG_CONTEXT)}.\n")
    W("| session | calls | median | p90 | max | median by quarter of the session | total | above 150k |")
    W("|---|---|---|---|---|---|---|---|")
    tot = over = 0
    for f in sessions:
        ctx = [c for _, c in api_calls(f, UNTIL_DT)]
        if not ctx:
            continue
        q = max(1, len(ctx) // 4)
        quarters = " / ".join(k(median(ctx[i : i + q])) for i in range(0, q * 4, q))
        o = sum(max(0, c - BIG_CONTEXT) for c in ctx)
        tot += sum(ctx)
        over += o
        W(f"| {os.path.basename(f)[:8]} | {len(ctx)} | {k(median(ctx))} | {k(p90(ctx))} | {k(max(ctx))} | {quarters} | {m(sum(ctx))} | {m(o)} |")
    compactions = sum(
        1
        for f in sessions
        for r in records(f, UNTIL_DT)
        if r.get("isCompactSummary") or r.get("subtype") == "compact_boundary"
    )
    W(f"\nAll main sessions: {m(tot)}, of which {m(over)} ({100 * over / tot:.0f}%) is context above {k(BIG_CONTEXT)}. "
      f"Compaction records (compact_boundary or a compact summary): {compactions}.\n")


def report_triggers(sessions, W):
    by = defaultdict(lambda: [0, 0, 0])  # calls, tokens, turns started
    for f in sessions:
        cur = None
        seen = set()
        for r in records(f, UNTIL_DT):
            if r.get("isSidechain"):
                continue
            if r.get("type") == "user":
                t = trigger(r)
                if t:
                    cur = t
                    by[t][2] += 1
            elif r.get("type") == "assistant" and cur:
                mid = r["message"].get("id")
                if mid in seen:
                    continue
                seen.add(mid)
                u = r["message"].get("usage", {})
                by[cur][0] += 1
                by[cur][1] += u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get(
                    "cache_creation_input_tokens", 0
                )
    total = sum(v[1] for v in by.values())
    W("### What woke the main session\n")
    W("Each API call is attributed to the last message that started a turn: a message from tacowars, a worker's hand-back, or a task notification.\n")
    W("| trigger | turns started | API calls | tokens | share |")
    W("|---|---|---|---|---|")
    for t, (calls, tok, starts) in sorted(by.items(), key=lambda x: -x[1][1]):
        W(f"| {t} | {starts} | {calls} | {m(tok)} | {100 * tok / total:.0f}% |")
    W("")


def report_main_tools(sessions, W):
    tok = Counter()
    calls = Counter()
    for f in sessions:
        for r, c in api_calls(f, UNTIL_DT):
            kinds = {main_tool_kind(b) for b in r["message"]["content"] if b.get("type") == "tool_use"}
            kinds = kinds or {"(text only: a reply or report)"}
            for kd in kinds:
                tok[kd] += c / len(kinds)
                calls[kd] += 1 / len(kinds)
    total = sum(tok.values())
    W("### Main-session tokens by the tool each call made\n")
    W("A call's context is split evenly between the kinds of tool it called.\n")
    W("| tool | calls | tokens | share |")
    W("|---|---|---|---|")
    for kd, v in tok.most_common(12):
        W(f"| {kd} | {calls[kd]:.0f} | {m(v)} | {100 * v / total:.0f}% |")
    W("")


def report_split(sessions, W):
    W("### Main session against its workers\n")
    W("Sessions that launched at least one worker. Worker tokens include every sub-agent of that session.\n")
    W("| session | workers | main | all sub-agents | main share |")
    W("|---|---|---|---|---|")
    th = ts_ = 0
    for f in sessions:
        subs = sub_agents(f)
        nw = sum(1 for s in subs if s[3])
        if not nw:
            continue
        h = sum(c for _, c in api_calls(f, UNTIL_DT))
        w = sum(c for s in subs for _, c in api_calls(s[0], UNTIL_DT, sidechain=True))
        th += h
        ts_ += w
        W(f"| {os.path.basename(f)[:8]} | {nw} | {m(h)} | {m(w)} | {100 * h / (h + w):.0f}% |")
    W(f"| all | | {m(th)} | {m(ts_)} | {100 * th / (th + ts_):.0f}% |\n")


def report_workers(sessions, W):
    first_ctx, per_turn, init_tok, cont_tok, init_turn, cont_turn = [], [], 0, 0, [], []
    fresh_fix = []
    handbacks = Counter()
    handback_chars = []
    result_chars = Counter()
    result_calls = Counter()
    check_secs = 0.0
    n = 0
    for f in sessions:
        for path, meta, prompt, worker in sub_agents(f):
            if not worker:
                continue
            n += 1
            calls = list(api_calls(path, UNTIL_DT, sidechain=True))
            if not calls:
                continue
            first_ctx.append(calls[0][1])
            per_turn += [c for _, c in calls]
            seg = 0
            hb = 0
            tot = 0
            for r, c in calls:
                tot += c
                if seg == 0:
                    init_tok += c
                    init_turn.append(c)
                else:
                    cont_tok += c
                    cont_turn.append(c)
                for b in r["message"]["content"]:
                    if b.get("type") == "tool_use" and b["name"] == "SubagentHandback":
                        seg += 1
                        hb += 1
                        handback_chars.append(len(b["input"].get("message", "")))
            handbacks[hb] += 1
            if FRESH_FIX_PROMPT.match(prompt):
                fresh_fix.append((tot, calls[0][1]))
            kinds, started = {}, {}
            for r in records(path, UNTIL_DT):
                c = r.get("message", {}).get("content")
                if not isinstance(c, list):
                    continue
                for b in c:
                    if b.get("type") == "tool_use":
                        kinds[b["id"]] = worker_result_kind(b["name"], b["input"].get("command", ""))
                        started[b["id"]] = ts(r["timestamp"])
                    elif b.get("type") == "tool_result":
                        kd = kinds.get(b.get("tool_use_id"), "?")
                        cc = b.get("content")
                        size = len(cc) if isinstance(cc, str) else sum(
                            len(x.get("text", "")) for x in cc or [] if isinstance(x, dict)
                        )
                        result_chars[kd] += size
                        result_calls[kd] += 1
                        if kd in ("vitest", "typecheck, lint") and b.get("tool_use_id") in started:
                            check_secs += (ts(r["timestamp"]) - started[b["tool_use_id"]]).total_seconds()
    W("## Workers\n")
    W(f"- {n} worker transcripts. Starting context (first call, including the cache write): median {k(median(first_ctx))}, p90 {k(p90(first_ctx))}.")
    W(f"- Context per call: median {k(median(per_turn))}, p90 {k(p90(per_turn))}.")
    W(f"- Tool time in vitest, typecheck and lint across all workers: {check_secs / 60:.0f} min.")
    W(f"- Hand-backs per worker: {dict(sorted(handbacks.items()))}; median hand-back {median(handback_chars)} characters.")
    W(f"- First runs (up to the first hand-back): {m(init_tok)}, median {k(median(init_turn))} per call.")
    W(f"- Rounds continued in the same worker after a hand-back: {m(cont_tok)} ({100 * cont_tok / (init_tok + cont_tok):.0f}% of worker tokens), median {k(median(cont_turn))} per call.")
    if fresh_fix:
        W(f"- Fix rounds given to a fresh worker: {len(fresh_fix)}, total {', '.join(m(t) for t, _ in fresh_fix)}; starting context {', '.join(k(s) for _, s in fresh_fix)}.")
    total = sum(result_chars.values())
    W("\n### What fills a worker's context: tool-result characters by kind\n")
    W("| kind | calls | characters | share | mean |")
    W("|---|---|---|---|---|")
    for kd, v in result_chars.most_common(12):
        W(f"| {kd} | {result_calls[kd]} | {k(v)} | {100 * v / total:.0f}% | {v / result_calls[kd] / 1e3:.1f}k |")
    W("")


def main():
    global UNTIL_DT
    until = UNTIL
    if "--until" in sys.argv:
        until = sys.argv[sys.argv.index("--until") + 1]
    UNTIL_DT = ts(until)
    out = []
    W = out.append
    W("# Main-session and worker token use, Windsor, measured from transcripts\n")
    W(f"Generated by `measure-hub.py` from `{PROJECT.replace(os.path.expanduser('~'), '~')}`, records up to {until}. "
      "Tokens are input-side context per API call (input + cache read + cache write), deduplicated by message id.\n")
    sessions = main_sessions(UNTIL_DT)
    report_main(sessions, W)
    report_split(sessions, W)
    report_triggers(sessions, W)
    report_main_tools(sessions, W)
    report_workers(sessions, W)
    print("\n".join(out))


UNTIL_DT = ts(UNTIL)

if __name__ == "__main__":
    main()
