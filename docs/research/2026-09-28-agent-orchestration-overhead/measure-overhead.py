#!/usr/bin/env python3
"""Measure tool-call and token overhead in Claude Code sub-agent transcripts.

Stdlib only. Reads ~/.claude/projects/<project>/<session>.jsonl (main
sessions) and <session>/subagents/agent-<id>.jsonl (+ .meta.json) (sub-agent
transcripts). Prints a markdown report to stdout and writes it beside this
script as transcript-overhead-report.md.

Schema as found (2026-09-28, Claude Code 2.1.26x-2.1.28x):
- One JSON record per line. `type` in {user, assistant, attachment, system,
  ...}. `message.role`, `message.content` (str or list of blocks with `type`
  in {text, thinking, tool_use, tool_result, image}).
- Assistant records are split ONE PER CONTENT BLOCK (`apiBlockIndex`), all
  carrying the same `message.id`, `requestId` and the same `message.usage`.
  Token sums therefore dedupe by `message.id`.
- `message.usage` has input_tokens, cache_read_input_tokens,
  cache_creation_input_tokens, output_tokens.
- Tool results arrive as `user` records with a `tool_result` block and a
  top-level `toolUseResult`.
- Sub-agent records carry `isSidechain: true` and `agentId`; they are stored
  in separate files, never inline in the parent session file.
- `.meta.json` beside each sub-agent file: agentType, description, toolUseId
  (links to the parent's Agent tool_use), spawnDepth, isFork, worktreePath.
"""

import glob
import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime

BASE = os.path.expanduser("~/.claude/projects")
HERE = os.path.dirname(os.path.abspath(__file__))

PROJECTS = {
    "Aotearoa204": [
        "-Users-arrakis-code-Aotearoa204",
        "-Users-arrakis-code-Aotearoa204-wt-431",
        "-Users-arrakis-code-Aotearoa204-wt-432",
    ],
    "HOOP": [
        "-Users-arrakis-code-HOOP",
        "-Users-arrakis-code-HOOP-docs-HOOP",
    ],
    "windsor (baseline)": [
        "-Users-arrakis-code-windsor",
    ],
}
# An older checkout of Aotearoa204 under iCloud; reported only as a note.
EXTRA_DIRS = {
    "Aotearoa204 (iCloud checkout, pre-fork)": [
        "-Users-arrakis-Library-Mobile-Documents-com-apple-CloudDocs-projects-Aotearoa204"
    ]
}

SECRET_RE = re.compile(
    r"(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9-]{20,}"
    r"|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|xox[abp]-[A-Za-z0-9-]{10,})"
)
DOTENV_RE = re.compile(r"(^|[\s/])\.env(\b|$)")

# Words kept out of the report: REPORT_HIDE_WORDS (comma-separated) in the
# repo's untracked .env, or in the environment. Each is matched as a whole
# word in any case, with an optional "'s" or "s", and becomes
# REPORT_HIDE_WITH (default "[hidden]") in prompts and session titles.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
HIDE_DEFAULT = "[hidden]"


def read_dotenv(path):
    """KEY=VALUE pairs from a .env file; blank lines, comments and a missing file are fine."""
    pairs = {}
    if not os.path.exists(path):
        return pairs
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            pairs[key.strip()] = value.strip().strip("'\"")
    return pairs


def hide_table(settings):
    """The (pattern, replacement) pairs for REPORT_HIDE_WORDS and REPORT_HIDE_WITH in `settings`."""
    words = [w.strip() for w in settings.get("REPORT_HIDE_WORDS", "").split(",") if w.strip()]
    with_ = settings.get("REPORT_HIDE_WITH") or HIDE_DEFAULT
    # Longer words first, so one that contains another is replaced whole.
    return [
        (re.compile(r"\b" + re.escape(w) + r"('s|s)?\b", re.IGNORECASE), with_)
        for w in sorted(words, key=len, reverse=True)
    ]


def hide_words(text, table):
    """`text` with every word in `table` replaced; a possessive or plural keeps its "'s"."""
    for pattern, with_ in table:
        text = pattern.sub(lambda m: with_ + ("'s" if m.group(1) else ""), text)
    return text


HIDE_TABLE = hide_table({**read_dotenv(os.path.join(REPO_ROOT, ".env")), **os.environ})


def require_hide_table(table):
    """Stop before writing anything when no words are set: the report is never written unfiltered."""
    if not table:
        raise SystemExit("REPORT_HIDE_WORDS is not set (repo .env or environment); not writing the report.")

# --------------------------------------------------------------------------
# Bash command classification
# --------------------------------------------------------------------------

HEREDOC_RE = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n(.*?)\n\s*\1(?=\s*$|\n)", re.S)
PREAMBLE_RE = re.compile(
    r"^(cd|pushd|popd|export|set|echo|printf|true|false|:|[A-Za-z_][A-Za-z0-9_]*=\S*)"
    r"(\s|$)"
)
PROCESS_SCRIPT_RE = re.compile(
    r"(board|ticket|codex|log\.sh|ciRegister|agent-phases|handoff|dev-bootstrap|verifyPreflight|phase|claim|status)",
    re.I,
)
READ_CMDS = {
    "cat", "ls", "find", "grep", "rg", "head", "tail", "wc", "less", "diff",
    "tree", "stat", "file", "du", "jq", "awk", "cut", "sort", "uniq", "tr",
    "xargs", "which", "type", "realpath", "basename", "dirname", "date", "pwd",
    "env", "nl", "od", "xxd", "cmp", "md5", "shasum", "column", "comm", "test",
    "[", "fgrep", "egrep", "tac", "rev", "strings", "readlink", "seq", "bc",
    "expr", "paste", "fold", "ag", "fd",
}
EDIT_CMDS = {"cp", "mv", "rm", "mkdir", "touch", "ln", "chmod", "tee", "rmdir", "unzip", "tar", "zip"}
POLL_CMDS = {"sleep", "pgrep", "ps", "wait", "kill", "lsof", "jobs", "pkill"}
WEB_CMDS = {"curl", "wget", "open"}
VERIFY_KINDS = {
    "verify": re.compile(r"\b(verify|ci|check)\b"),
    "test": re.compile(r"\b(test|vitest|jest|playwright|e2e)\b"),
    "lint/typecheck": re.compile(r"\b(lint|eslint|tsc|typecheck|type-check)\b"),
    "format": re.compile(r"\b(format|prettier)\b"),
    "build": re.compile(r"\b(build|vite|bundle|worklets|patch-index|ci\b|install)\b"),
}
SCRIPT_RE = re.compile(
    r"(?:^|\s)(?:bash\s+|sh\s+|node\s+(?:--test\s+)?|python3?\s+|\./)?"
    r"((?:[\w./-]*/)?(?:scripts/[\w./-]+|tools/[\w.-]+)\.(?:sh|mjs|js|py))(?=\s|$|['\";)])"
)


def split_segments(cmd):
    """Return (segments, heredoc_bodies) for a shell command string."""
    bodies = []

    def _keep(m):
        bodies.append(m.group(2))
        return " <<HEREDOC "

    stripped = HEREDOC_RE.sub(_keep, cmd)
    # Split on newlines, && , ||, ' | ', and ';' (not inside obvious quotes is
    # too hard without a parser; ' | ' with spaces avoids grep '\|' patterns).
    parts = re.split(r"\n|&&|\|\||\s\|\s|;\s|;$", stripped)
    segs = []
    for p in parts:
        p = p.strip()
        p = re.sub(r"^\(\s*", "", p)
        p = re.sub(r"^(sudo\s+|time\s+|nohup\s+|VITEST_MAX_WORKERS=\S+\s+)", "", p)
        p = re.sub(r"^([A-Za-z_][A-Za-z0-9_]*=\S+\s+)+(?=\S)", "", p)  # leading VAR=x assignments before a command
        if not p or PREAMBLE_RE.match(p):
            continue
        segs.append(p)
    return segs, bodies


def classify_segment(seg, bodies, original):
    """Map one shell segment to a bucket name. Returns (bucket, detail)."""
    words = seg.split()
    if not words:
        return ("other", None)
    head = words[0]
    if head == "bash" and len(words) > 1 and words[1] == "-c":
        head = "bash -c"
    # gh
    if head == "gh":
        sub = words[1] if len(words) > 1 else ""
        if sub == "issue":
            return ("gh:issue", None)
        if sub == "pr":
            return ("gh:pr", None)
        if sub in ("project", "api"):
            return ("gh:project/api", None)
        return ("gh:other", sub)
    # git
    if head == "git":
        sub = words[1] if len(words) > 1 else ""
        if sub.startswith("-C") and len(words) > 3:
            sub = words[3]
        if sub == "worktree":
            return ("git:worktree", None)
        if sub in ("add", "commit"):
            return ("git:commit", None)
        if sub == "push":
            return ("git:push", None)
        if sub in ("status", "log", "diff", "show", "branch", "grep", "rev-parse",
                   "ls-files", "blame", "remote", "describe", "rev-list", "shortlog",
                   "for-each-ref", "cat-file", "stash"):
            return ("git:inspect", None)
        return ("git:other", sub)
    # repo scripts (scripts/ or tools/)
    m = SCRIPT_RE.search(seg)
    if m and not seg.startswith(("sed", "cat", "grep", "rg", "ls", "head", "tail", "wc", "find", "chmod", "git", "gh")):
        name = os.path.basename(m.group(1))
        if ".test." in name:
            return ("verify:test", name)
        if PROCESS_SCRIPT_RE.search(name):
            return ("script:process", name)
        return ("script:build", name)
    # npm / npx / node
    if head in ("npm", "npx", "pnpm", "yarn", "node", "vitest", "tsc", "eslint", "prettier"):
        if head == "node" and len(words) > 1 and (words[1].startswith("-e") or words[1] == "-"):
            return ("node-inline", None)
        if head == "node" and len(words) > 1 and words[1].endswith((".mjs", ".js", ".cjs")):
            return ("node-other", os.path.basename(words[1]))
        for kind, rx in VERIFY_KINDS.items():
            if rx.search(seg):
                return ("verify:" + kind, None)
        return ("npm-other", " ".join(words[:2]))
    if head == "codex":
        return ("codex-review", None)
    if head == "claude":
        return ("claude-cli", None)
    # python inline
    if head in ("python3", "python") and (len(words) > 1 and words[1] in ("-", "-c")):
        text = "\n".join(bodies) + (seg if words[1] == "-c" else "")
        if re.search(r"open\([^)]*['\"]w['\"]|\.write\(|write_text\(|os\.rename|shutil\.", text):
            return ("python-inline:edit", None)
        return ("python-inline:other", None)
    if head in ("python3", "python"):
        return ("python-script", os.path.basename(words[1]) if len(words) > 1 else None)
    if head == "perl" and re.search(r"-\w*[pi]\w*i", seg):
        return ("edit:shell", "perl -pi")
    if head == "sed":
        if re.search(r"\s-i\b|\s-i'", seg) or " -i " in seg:
            return ("edit:shell", "sed -i")
        return ("read:shell", "sed")
    if head == "cat" and re.search(r"cat\s*>+", seg):
        return ("edit:shell", "cat >")
    if head in EDIT_CMDS:
        return ("edit:shell", head)
    if head == "tail" and ("/tasks/" in seg or ".output" in seg or "-f" in words):
        return ("poll/wait", "tail task output")
    if head in READ_CMDS:
        return ("read:shell", head)
    if head in POLL_CMDS:
        return ("poll/wait", head)
    if head in WEB_CMDS:
        return ("web:shell", head)
    if head in ("for", "while", "if", "case", "function", "do", "done", "then", "fi", "else", "elif", "esac", "{", "}", "bash -c"):
        return ("shell-control", head)
    if head.startswith("./") or head.startswith("/"):
        return ("other", os.path.basename(head))
    return ("other", head)


def classify_bash(cmd):
    """Return (primary_bucket, primary_detail, [(bucket, detail)...])."""
    segs, bodies = split_segments(cmd)
    labels = [classify_segment(s, bodies, cmd) for s in segs]
    # shell-control segments (for/while/if) carry no information on their own;
    # take the first informative label as primary.
    informative = [l for l in labels if l[0] != "shell-control"] or labels
    primary = informative[0] if informative else ("other", None)
    return primary, labels


PROCESS_BUCKETS = {
    "gh:issue", "gh:pr", "gh:project/api", "gh:other", "git:worktree",
    "git:commit", "git:push", "git:other", "script:process", "poll/wait",
    "codex-review", "claude-cli",
}
PROCESS_TOOLS = {"SubagentHandback", "Skill", "ToolSearch", "Agent", "Task",
                 "Monitor", "TaskStop", "SendMessage", "EnterWorktree", "ExitWorktree"}
WORK_BUCKETS = {
    "read:shell", "edit:shell", "python-inline:edit", "python-inline:other",
    "python-script", "node-inline", "node-other", "npm-other", "script:build",
    "verify:verify", "verify:test", "verify:lint/typecheck", "verify:format", "verify:build",
}
WORK_TOOLS = {"Read", "Edit", "Write", "Grep", "Glob", "MultiEdit", "NotebookEdit"}


def group_of(tool, bucket):
    if tool == "Bash":
        if bucket in PROCESS_BUCKETS:
            return "process"
        if bucket in WORK_BUCKETS:
            return "work"
        return "inspect/other"
    if tool in PROCESS_TOOLS:
        return "process"
    if tool in WORK_TOOLS:
        return "work"
    return "inspect/other"


# --------------------------------------------------------------------------
# Transcript loading
# --------------------------------------------------------------------------

def iter_records(path):
    with open(path, errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                yield {"type": "<bad json>"}


def parse_ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def block_text(content):
    if isinstance(content, str):
        return content
    out = []
    for b in content or []:
        if isinstance(b, dict) and b.get("type") == "text":
            out.append(b.get("text", ""))
    return "\n".join(out)


def load_transcript(path):
    """Parse one jsonl (main session or sub-agent) into a summary dict."""
    t = {
        "path": path,
        "records": 0,
        "bad_json": 0,
        "types": Counter(),
        "ts": [],
        "first_prompt": None,
        "first_prompt_ts": None,
        "custom_title": None,
        "tool_uses": [],  # (ts, name, primary_bucket, detail, labels, is_agent_launch, tool_id)
        "tools": Counter(),
        "bash_primary": Counter(),
        "bash_segments": Counter(),
        "script_names": Counter(),
        "agent_launches": [],  # (ts, subagent_type, description, tool_id)
        "msgs": {},  # message.id -> usage dict (max per field)
        "msg_order": [],
        "models": Counter(),
        "secretish_records": 0,
        "dotenv_cmds": 0,
        "unclassified_bash": 0,
        "cwds": set(),
        "versions": set(),
        "out_chars": 0,  # measured length of assistant text+thinking+tool_use input (JSON), per unique block
        "cost_state": None,  # last cost-state record in the file (main sessions only)
        "seen_blocks": set(),
        "use_ts": {},  # tool_use id -> timestamp of the assistant record
        "result_ts": {},  # tool_use id -> timestamp of the tool_result record
    }
    for r in iter_records(path):
        t["records"] += 1
        typ = r.get("type")
        t["types"][typ] += 1
        if typ == "<bad json>":
            t["bad_json"] += 1
            continue
        if typ == "custom-title":
            t["custom_title"] = hide_words(r.get("customTitle") or "", HIDE_TABLE) or None
        if typ == "cost-state":
            t["cost_state"] = r
        ts = parse_ts(r.get("timestamp", "")) if r.get("timestamp") else None
        if ts:
            t["ts"].append(ts)
        if r.get("cwd"):
            t["cwds"].add(r["cwd"])
        if r.get("version"):
            t["versions"].add(r["version"])
        m = r.get("message") or {}
        content = m.get("content")
        if typ == "user" and isinstance(content, list) and ts:
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id"):
                    t["result_ts"].setdefault(b["tool_use_id"], ts)
        if typ == "user" and t["first_prompt"] is None and not r.get("isMeta"):
            txt = block_text(content)
            if txt and not txt.startswith("<command-") and "tool_result" not in json.dumps(content)[:40]:
                if SECRET_RE.search(txt):
                    t["secretish_records"] += 1
                    txt = "[redacted: secret-like content]"
                t["first_prompt"] = hide_words(re.sub(r"\s+", " ", txt), HIDE_TABLE)[:120]
                t["first_prompt_ts"] = ts
        if typ == "assistant":
            mid = m.get("id") or r.get("requestId") or r.get("uuid")
            usage = m.get("usage") or {}
            t["models"][m.get("model")] += 1
            if mid not in t["msgs"]:
                t["msgs"][mid] = {"ts": ts, "input": 0, "cache_read": 0, "cache_create": 0, "output": 0}
                t["msg_order"].append(mid)
            u = t["msgs"][mid]
            u["input"] = max(u["input"], usage.get("input_tokens", 0) or 0)
            u["cache_read"] = max(u["cache_read"], usage.get("cache_read_input_tokens", 0) or 0)
            u["cache_create"] = max(u["cache_create"], usage.get("cache_creation_input_tokens", 0) or 0)
            u["output"] = max(u["output"], usage.get("output_tokens", 0) or 0)
            if isinstance(content, list):
                for bi, b in enumerate(content):
                    bkey = (mid, r.get("apiBlockIndex", bi), b.get("type"))
                    if bkey not in t["seen_blocks"]:
                        t["seen_blocks"].add(bkey)
                        if b.get("type") == "tool_use":
                            t["out_chars"] += len(json.dumps(b.get("input") or {}))
                        else:
                            t["out_chars"] += len(b.get("text") or b.get("thinking") or "")
                    if b.get("type") != "tool_use":
                        continue
                    name = b.get("name", "?")
                    inp = b.get("input") or {}
                    t["tools"][name] += 1
                    primary, labels = (None, None), []
                    if name == "Bash":
                        cmd = inp.get("command", "") or ""
                        if SECRET_RE.search(cmd):
                            t["secretish_records"] += 1
                        if DOTENV_RE.search(cmd):
                            t["dotenv_cmds"] += 1
                        primary, labels = classify_bash(cmd)
                        t["bash_primary"][primary[0]] += 1
                        if primary[0] == "other":
                            t["unclassified_bash"] += 1
                        for bk, det in labels:
                            t["bash_segments"][bk] += 1
                            if bk.startswith("script:") and det:
                                t["script_names"][det] += 1
                    if b.get("id") and ts:
                        t["use_ts"].setdefault(b["id"], ts)
                    is_launch = name in ("Agent", "Task")
                    if is_launch:
                        t["agent_launches"].append((ts, inp.get("subagent_type"), inp.get("description"), b.get("id")))
                    t["tool_uses"].append((ts, name, primary[0], primary[1], labels, is_launch, b.get("id")))
    t["ts"].sort()
    return t


def tokens(t):
    s = {"input": 0, "cache_read": 0, "cache_create": 0, "output": 0}
    for u in t["msgs"].values():
        for k in s:
            s[k] += u[k]
    s["turns"] = len(t["msgs"])
    s["out_chars"] = t["out_chars"]
    first = t["msgs"][t["msg_order"][0]] if t["msg_order"] else None
    s["first_ctx"] = (first["input"] + first["cache_read"]) if first else 0
    s["first_ctx_full"] = (first["input"] + first["cache_read"] + first["cache_create"]) if first else 0
    return s


def duration_s(t):
    if len(t["ts"]) < 2:
        return 0.0
    return (t["ts"][-1] - t["ts"][0]).total_seconds()


# --------------------------------------------------------------------------
# Role tagging for sub-agents
# --------------------------------------------------------------------------

def role_of(meta, prompt):
    at = (meta or {}).get("agentType") or "?"
    p = (prompt or "").lower()
    d = ((meta or {}).get("description") or "").lower()
    if at == "ticket-implementer":
        return "implementer"
    if meta and meta.get("isFork"):
        return "fork"
    if "review" in p[:200] or "review" in d:
        return "reviewer"
    if any(w in d or w in p[:200] for w in ("research", "survey", "websearch", "compare")):
        return "research"
    if any(w in d or w in p[:200] for w in ("document", "docs", "write up", "record")):
        return "docs"
    if at == "Explore":
        return "explore"
    if any(w in d or w in p[:200] for w in ("measure", "benchmark", "profile")):
        return "measure"
    return at


# --------------------------------------------------------------------------
# Stats helpers
# --------------------------------------------------------------------------

def median(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else 0


def p90(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return 0
    k = int(round(0.9 * (len(xs) - 1)))
    return xs[k]


def fmt_dur(s):
    s = int(s)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}h{m:02d}m" if h else f"{m}m{sec:02d}s"


def fmt_k(n):
    return f"{n/1000:.1f}k" if n >= 1000 else str(int(n))


def pct(a, b):
    return f"{100.0*a/b:.0f}%" if b else "-"


# --------------------------------------------------------------------------
# Per-project collection
# --------------------------------------------------------------------------

def collect(dirs):
    sessions = []
    subagents = []
    for d in dirs:
        root = os.path.join(BASE, d)
        if not os.path.isdir(root):
            continue
        for f in sorted(glob.glob(os.path.join(root, "*.jsonl"))):
            s = load_transcript(f)
            s["dir"] = d
            s["id"] = os.path.basename(f)[:-6]
            sessions.append(s)
        for f in sorted(glob.glob(os.path.join(root, "*", "subagents", "*.jsonl"))):
            meta_path = f[:-6] + ".meta.json"
            meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
            a = load_transcript(f)
            a["dir"] = d
            a["meta"] = meta
            a["parent"] = os.path.basename(os.path.dirname(os.path.dirname(f)))
            a["id"] = os.path.basename(f)[:-6]
            a["role"] = role_of(meta, a["first_prompt"])
            subagents.append(a)
    return sessions, subagents


def bucket_table(counter, total, top=None):
    rows = []
    items = counter.most_common(top) if top else sorted(counter.items(), key=lambda kv: -kv[1])
    for k, v in items:
        rows.append(f"| {k} | {v} | {pct(v, total)} |")
    return rows


def tool_seconds(t, tool_id):
    """Seconds between the tool_use record and its tool_result record, or None."""
    a, b = t["use_ts"].get(tool_id), t["result_ts"].get(tool_id)
    if a and b:
        return max((b - a).total_seconds(), 0.0)
    return None


def time_by_bucket(transcripts):
    """(bucket -> seconds, bucket -> calls, unmatched calls, total matched seconds)."""
    secs, calls = Counter(), Counter()
    unmatched = 0
    for t in transcripts:
        for (_, name, bucket, _, _, _, tid) in t["tool_uses"]:
            key = f"Bash/{bucket}" if name == "Bash" else name
            d = tool_seconds(t, tid)
            calls[key] += 1
            if d is None:
                unmatched += 1
                continue
            secs[key] += d
    return secs, calls, unmatched


def tool_time_share(t):
    """Fraction of a transcript's elapsed time spent inside tool calls (matched ones)."""
    total = sum(d for (_, _, _, _, _, _, tid) in t["tool_uses"] for d in [tool_seconds(t, tid)] if d is not None)
    el = duration_s(t)
    return (min(total / el, 1.0) if el else 0.0), total


def process_share(transcripts):
    g = Counter()
    for t in transcripts:
        for (_, name, bucket, _, _, _, _) in t["tool_uses"]:
            g[group_of(name, bucket)] += 1
    return g


def report_project(name, sessions, subagents, out):
    W = out.append
    W(f"\n## {name}\n")
    all_ts = [ts for s in sessions for ts in s["ts"]] + [ts for a in subagents for ts in a["ts"]]
    rng = f"{min(all_ts).date()} .. {max(all_ts).date()}" if all_ts else "-"
    n_assist = sum(len(s["msgs"]) for s in sessions)
    W(f"- Main session files: {len(sessions)} (with any assistant turn: {sum(1 for s in sessions if s['msgs'])}); "
      f"assistant API turns in main sessions: {n_assist}")
    W(f"- Sub-agent transcripts: {len(subagents)}; date range: {rng}")
    versions = sorted({v for s in sessions + subagents for v in s["versions"]})
    W(f"- Claude Code versions seen: {', '.join(versions) if versions else '-'}")
    if subagents:
        at = Counter(a["meta"].get("agentType", "?") for a in subagents)
        W(f"- Sub-agent types (from .meta.json): {dict(at)}")
        depths = Counter(a["meta"].get("spawnDepth") for a in subagents)
        W(f"- spawnDepth: {dict(depths)}")
    if not sessions and not subagents:
        W("- No transcripts found.")
        return
    total_tools_main = sum(sum(s["tools"].values()) for s in sessions)
    total_tools_sub = sum(sum(a["tools"].values()) for a in subagents)
    W(f"- Tool calls: main sessions {total_tools_main}, sub-agents {total_tools_sub}")
    tk_main = [tokens(s) for s in sessions]
    tk_sub = [tokens(a) for a in subagents]
    W(f"- Tokens, main sessions: input+cache_read {fmt_k(sum(t['input']+t['cache_read'] for t in tk_main))}, "
      f"cache_create {fmt_k(sum(t['cache_create'] for t in tk_main))}, assistant output chars {fmt_k(sum(t['out_chars'] for t in tk_main))} "
      f"(recorded output_tokens {fmt_k(sum(t['output'] for t in tk_main))}, undercounts; see caveats)")
    if subagents:
        W(f"- Tokens, sub-agents: input+cache_read {fmt_k(sum(t['input']+t['cache_read'] for t in tk_sub))}, "
          f"cache_create {fmt_k(sum(t['cache_create'] for t in tk_sub))}, assistant output chars {fmt_k(sum(t['out_chars'] for t in tk_sub))} "
          f"(recorded output_tokens {fmt_k(sum(t['output'] for t in tk_sub))}, undercounts)")
        cs_usd = sum((s['cost_state'] or {}).get('totalCostUSD', 0) for s in sessions)
        cs_out = sum(sum(v.get('outputTokens', 0) for v in (s['cost_state'] or {}).get('modelUsage', {}).values()) for s in sessions)
        W(f"- Harness cost-state totals over all main sessions (sub-agents included): cost USD {cs_usd:.2f}, output tokens {fmt_k(cs_out)}")

    # ---- per sub-agent table
    if subagents:
        W("\n### Per sub-agent transcript\n")
        W("| # | parent | type | role | tools | Bash | Read | Edit | Write | Grep/Glob | other | turns | dur | out chars | out tok (recorded, undercounts) | in+cache_read | cache_create | first-turn ctx (in+read / +create) | prompt |")
        W("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for i, a in enumerate(sorted(subagents, key=lambda a: a["ts"][0] if a["ts"] else datetime.min), 1):
            tk = tokens(a)
            tl = a["tools"]
            other = sum(v for k, v in tl.items() if k not in ("Bash", "Read", "Edit", "Write", "Grep", "Glob"))
            W(f"| {i} | {a['parent'][:8]} | {a['meta'].get('agentType','?')} | {a['role']} | {sum(tl.values())} | "
              f"{tl['Bash']} | {tl['Read']} | {tl['Edit']} | {tl['Write']} | {tl['Grep']+tl['Glob']} | {other} | "
              f"{tk['turns']} | {fmt_dur(duration_s(a))} | {fmt_k(tk['out_chars'])} | {fmt_k(tk['output'])} | {fmt_k(tk['input']+tk['cache_read'])} | "
              f"{fmt_k(tk['cache_create'])} | {fmt_k(tk['first_ctx'])} / {fmt_k(tk['first_ctx_full'])} | "
              f"{(a['first_prompt'] or '').replace('|','/')[:120]} |")

        # ---- aggregates
        W("\n### Sub-agent aggregates\n")
        tc = [sum(a["tools"].values()) for a in subagents]
        durs = [duration_s(a) for a in subagents]
        W("| metric | median | p90 | max |")
        W("|---|---|---|---|")
        W(f"| tool calls per sub-agent | {median(tc):.0f} | {p90(tc)} | {max(tc)} |")
        W(f"| Bash calls per sub-agent | {median([a['tools']['Bash'] for a in subagents]):.0f} | {p90([a['tools']['Bash'] for a in subagents])} | {max(a['tools']['Bash'] for a in subagents)} |")
        W(f"| assistant turns per sub-agent | {median([t['turns'] for t in tk_sub]):.0f} | {p90([t['turns'] for t in tk_sub])} | {max(t['turns'] for t in tk_sub)} |")
        W(f"| duration | {fmt_dur(median(durs))} | {fmt_dur(p90(durs))} | {fmt_dur(max(durs))} |")
        W(f"| total input incl. cache_read | {fmt_k(median([t['input']+t['cache_read'] for t in tk_sub]))} | {fmt_k(p90([t['input']+t['cache_read'] for t in tk_sub]))} | {fmt_k(max(t['input']+t['cache_read'] for t in tk_sub))} |")
        W(f"| total cache_create | {fmt_k(median([t['cache_create'] for t in tk_sub]))} | {fmt_k(p90([t['cache_create'] for t in tk_sub]))} | {fmt_k(max(t['cache_create'] for t in tk_sub))} |")
        W(f"| assistant output chars (text+thinking+tool_use JSON; measured) | {fmt_k(median([t['out_chars'] for t in tk_sub]))} | {fmt_k(p90([t['out_chars'] for t in tk_sub]))} | {fmt_k(max(t['out_chars'] for t in tk_sub))} |")
        W(f"| output tokens as recorded (UNRELIABLE, see caveats) | {fmt_k(median([t['output'] for t in tk_sub]))} | {fmt_k(p90([t['output'] for t in tk_sub]))} | {fmt_k(max(t['output'] for t in tk_sub))} |")
        W(f"| first-turn context (input+cache_read) | {fmt_k(median([t['first_ctx'] for t in tk_sub]))} | {fmt_k(p90([t['first_ctx'] for t in tk_sub]))} | {fmt_k(max(t['first_ctx'] for t in tk_sub))} |")
        W(f"| first-turn context incl. cache_create | {fmt_k(median([t['first_ctx_full'] for t in tk_sub]))} | {fmt_k(p90([t['first_ctx_full'] for t in tk_sub]))} | {fmt_k(max(t['first_ctx_full'] for t in tk_sub))} |")
        W(f"| context per turn (input+cache_read+create)/turns | {fmt_k(median([(t['input']+t['cache_read']+t['cache_create'])/max(t['turns'],1) for t in tk_sub]))} | {fmt_k(p90([(t['input']+t['cache_read']+t['cache_create'])/max(t['turns'],1) for t in tk_sub]))} | - |")

        # role split
        W("\n#### By role\n")
        W("| role | n | median tools | median dur | median out chars | median in+cache_read | median first ctx |")
        W("|---|---|---|---|---|---|---|")
        for role in sorted({a["role"] for a in subagents}):
            grp = [a for a in subagents if a["role"] == role]
            tkg = [tokens(a) for a in grp]
            W(f"| {role} | {len(grp)} | {median([sum(a['tools'].values()) for a in grp]):.0f} | "
              f"{fmt_dur(median([duration_s(a) for a in grp]))} | {fmt_k(median([t['out_chars'] for t in tkg]))} | "
              f"{fmt_k(median([t['input']+t['cache_read'] for t in tkg]))} | {fmt_k(median([t['first_ctx'] for t in tkg]))} |")

        # tool-name share
        W("\n#### Tool-call share across all sub-agents\n")
        tools_all = Counter()
        for a in subagents:
            tools_all.update(a["tools"])
        W("| tool | calls | share |")
        W("|---|---|---|")
        out.extend(bucket_table(tools_all, total_tools_sub))

        # bash buckets
        W("\n#### Bash buckets (sub-agents): primary bucket per call, and per shell segment\n")
        prim = Counter()
        segs = Counter()
        scripts = Counter()
        for a in subagents:
            prim.update(a["bash_primary"])
            segs.update(a["bash_segments"])
            scripts.update(a["script_names"])
        nb = sum(prim.values())
        ns = sum(segs.values())
        W(f"Bash calls: {nb}; shell segments after splitting on `&&`, `;`, `|`, newlines and dropping `cd`/`export`/`echo` preambles: {ns} ({ns/nb:.1f} per call)\n" if nb else "No Bash calls.\n")
        W("| bucket | calls (primary) | share | segments | share |")
        W("|---|---|---|---|---|")
        for k in sorted(set(prim) | set(segs), key=lambda k: -(segs[k])):
            W(f"| {k} | {prim[k]} | {pct(prim[k], nb)} | {segs[k]} | {pct(segs[k], ns)} |")
        if scripts:
            W("\nRepo scripts called (segments, by basename):\n")
            W("| script | segments |")
            W("|---|---|")
            for k, v in scripts.most_common():
                W(f"| {k} | {v} |")

        # process share
        W("\n#### Process share (all tool calls, primary bucket)\n")
        g = process_share(subagents)
        tot = sum(g.values())
        W("| group | calls | share |")
        W("|---|---|---|")
        for k in ("process", "work", "inspect/other"):
            W(f"| {k} | {g[k]} | {pct(g[k], tot)} |")
        W("\nprocess = gh:*, git worktree/commit/push/other, repo scripts (board/ticket/handoff), poll/wait, codex/claude CLI, SubagentHandback, Skill, ToolSearch, Agent, Monitor, TaskStop. "
          "work = shell reads/edits, python/node inline, npm/npx verify/test/lint/build, Read/Edit/Write/Grep/Glob. inspect/other = git status/log/diff, web, MCP, unclassified.")
        # by role process share
        W("\n| role | process | work | inspect/other |")
        W("|---|---|---|---|")
        for role in sorted({a["role"] for a in subagents}):
            grp = [a for a in subagents if a["role"] == role]
            gg = process_share(grp)
            tt = sum(gg.values())
            W(f"| {role} (n={len(grp)}) | {gg['process']} ({pct(gg['process'], tt)}) | {gg['work']} ({pct(gg['work'], tt)}) | {gg['inspect/other']} ({pct(gg['inspect/other'], tt)}) |")

        # per-sub-agent process share distribution
        shares = []
        for a in subagents:
            gg = process_share([a])
            tt = sum(gg.values())
            if tt:
                shares.append(gg["process"] / tt)
        W(f"\nPer-sub-agent process share: median {100*median(shares):.0f}%, p90 {100*p90(shares):.0f}%")

        # ---- wall time inside tool calls, by bucket
        W("\n#### Wall time inside tool calls (tool_use record to tool_result record), sub-agents, by bucket\n")
        secs, calls, unmatched = time_by_bucket(subagents)
        tot_s = sum(secs.values())
        tts = [tool_time_share(a)[0] for a in subagents]
        W(f"Matched {sum(calls.values()) - unmatched}/{sum(calls.values())} tool calls to a result record. Total time inside tools {fmt_dur(tot_s)} "
          f"of {fmt_dur(sum(duration_s(a) for a in subagents))} elapsed across all sub-agents; per sub-agent share of elapsed time inside tools: "
          f"median {100*median(tts):.0f}%, p90 {100*p90(tts):.0f}%. The rest is model time (thinking, generation) plus harness/permission waits.\n")
        W("| bucket | calls | time | share of tool time | mean s/call |")
        W("|---|---|---|---|---|")
        for k, v in secs.most_common(16):
            W(f"| {k} | {calls[k]} | {fmt_dur(v)} | {pct(v, tot_s)} | {v/calls[k]:.0f} |")
        pg = Counter()
        for k, v in secs.items():
            tool, _, bucket = k.partition("/")
            pg[group_of("Bash" if tool == "Bash" else tool, bucket if tool == "Bash" else None)] += v
        W(f"\nTool time by group: process {fmt_dur(pg['process'])} ({pct(pg['process'], tot_s)}), work {fmt_dur(pg['work'])} ({pct(pg['work'], tot_s)}), "
          f"inspect/other {fmt_dur(pg['inspect/other'])} ({pct(pg['inspect/other'], tot_s)})")
        W("\nTool time includes any permission-prompt wait before the command ran; parallel tool calls in one turn overlap, so per-transcript shares can exceed 100%.")
        # per repo-script call durations
        sd = defaultdict(list)
        for a in subagents:
            for (_, name, bucket, det, labels, _, tid) in a["tool_uses"]:
                if name != "Bash":
                    continue
                names = {l[1] for l in labels if l[0].startswith("script:") and l[1]}
                d = tool_seconds(a, tid)
                for nm in names:
                    sd[nm].append(d if d is not None else 0)
        if sd:
            W("\nDuration of Bash calls that invoke a repo script (whole call, which may include other segments):\n")
            W("| script | calls | median s | p90 s | max s | total |")
            W("|---|---|---|---|---|---|")
            for nm, ds in sorted(sd.items(), key=lambda kv: -sum(kv[1])):
                W(f"| {nm} | {len(ds)} | {median(ds):.0f} | {p90(ds):.0f} | {max(ds):.0f} | {fmt_dur(sum(ds))} |")

        # ---- phases for implementers: orient (before first edit) / implement / finish (from first ticket-finish call)
        impl = [a for a in subagents if a["role"] == "implementer"]
        if impl:
            W("\n#### Implementer phases: orient (calls before the first edit) / implement / finish (from the first `ticket-finish` call to the end)\n")
            W("| sub-agent | tools | orient calls | orient time | implement calls | implement time | finish calls | finish time | finish share of calls | finish share of time |")
            W("|---|---|---|---|---|---|---|---|---|---|")
            fshare_c, fshare_t, oshare_c, oshare_t = [], [], [], []
            fin_calls, fin_secs, fin_model_s = Counter(), Counter(), 0.0
            for a in sorted(impl, key=lambda a: a["ts"][0] if a["ts"] else datetime.min):
                seq = a["tool_uses"]
                n = len(seq)
                if n == 0:
                    continue
                t0 = a["ts"][0]
                tend = a["ts"][-1]
                first_edit = next((i for i, tu in enumerate(seq) if tu[1] in ("Edit", "Write", "MultiEdit")
                                   or (tu[1] == "Bash" and any(l[0] in ("edit:shell", "python-inline:edit") for l in tu[4]))), n)
                first_finish = next((i for i, tu in enumerate(seq) if tu[1] == "Bash" and any(l[1] and "ticket-finish" in l[1] for l in tu[4])), n)
                if first_finish < first_edit:
                    first_edit = first_finish
                def ts_at(i):
                    return seq[i][0] if i < n and seq[i][0] else tend
                o_t = (ts_at(first_edit) - t0).total_seconds()
                i_t = (ts_at(first_finish) - ts_at(first_edit)).total_seconds()
                f_t = (tend - ts_at(first_finish)).total_seconds()
                tot_t = max((tend - t0).total_seconds(), 1)
                oc, ic, fc = first_edit, first_finish - first_edit, n - first_finish
                fshare_c.append(fc / n)
                fshare_t.append(f_t / tot_t)
                oshare_c.append(oc / n)
                oshare_t.append(o_t / tot_t)
                matched_s = 0.0
                for tu in seq[first_finish:]:
                    key = f"Bash/{tu[2]}" if tu[1] == "Bash" else tu[1]
                    fin_calls[key] += 1
                    d = tool_seconds(a, tu[6])
                    if d is not None:
                        fin_secs[key] += d
                        matched_s += d
                fin_model_s += max(f_t - matched_s, 0.0)
                W(f"| {a['id'][-8:]} | {n} | {oc} | {fmt_dur(o_t)} | {ic} | {fmt_dur(i_t)} | {fc} | {fmt_dur(f_t)} | {100*fc/n:.0f}% | {100*f_t/tot_t:.0f}% |")
            W(f"\nMedians over implementers: orient share of calls {100*median(oshare_c):.0f}% (time {100*median(oshare_t):.0f}%), "
              f"finish share of calls {100*median(fshare_c):.0f}% (time {100*median(fshare_t):.0f}%); "
              f"implementers that never called ticket-finish: {sum(1 for x in fshare_c if x == 0)}/{len(fshare_c)}")
            W("\nWhat the finish phase is made of (all implementers, calls from the first ticket-finish to the end):\n")
            W("| bucket | calls | time inside tool | mean s/call |")
            W("|---|---|---|---|")
            for k, v in fin_calls.most_common(12):
                W(f"| {k} | {v} | {fmt_dur(fin_secs[k])} | {fin_secs[k]/v:.0f} |")
            W(f"\nFinish phase totals: {sum(fin_calls.values())} calls, {fmt_dur(sum(fin_secs.values()))} inside tools, "
              f"{fmt_dur(fin_model_s)} outside tools (model turns, harness, waits).")

        # ---- top 10 longest
        W("\n#### Top 10 longest sub-agent runs (by wall clock)\n")
        W("| dur | type | role | tools | tool breakdown (top 6) | top Bash buckets | process/work/other | turns | out chars | in+cache_read | cache_create | first ctx (+create) | prompt |")
        W("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for a in sorted(subagents, key=duration_s, reverse=True)[:10]:
            tk = tokens(a)
            tb = ", ".join(f"{k} {v}" for k, v in a["tools"].most_common(6))
            bb = ", ".join(f"{k} {v}" for k, v in a["bash_primary"].most_common(6))
            gg = process_share([a])
            W(f"| {fmt_dur(duration_s(a))} | {a['meta'].get('agentType','?')} | {a['role']} | {sum(a['tools'].values())} | {tb} | {bb} | "
              f"{gg['process']}/{gg['work']}/{gg['inspect/other']} | "
              f"{tk['turns']} | {fmt_k(tk['out_chars'])} | {fmt_k(tk['input']+tk['cache_read'])} | {fmt_k(tk['cache_create'])} | {fmt_k(tk['first_ctx_full'])} | "
              f"{(a['first_prompt'] or '').replace('|','/')[:100]} |")

        # ---- first-turn context distribution
        W("\n#### First-turn context distribution (input_tokens + cache_read_input_tokens on the first assistant turn)\n")
        fc = sorted(t["first_ctx"] for t in tk_sub)
        fcf = sorted(t["first_ctx_full"] for t in tk_sub)
        W("| stat | in+cache_read | in+cache_read+cache_create |")
        W("|---|---|---|")
        for lab, fn in (("min", min), ("p10", lambda xs: xs[int(0.1*(len(xs)-1))]), ("median", median),
                        ("p90", p90), ("max", max)):
            W(f"| {lab} | {fmt_k(fn(fc))} | {fmt_k(fn(fcf))} |")
        W("\nNote: on a sub-agent's first turn the freshly assembled context (system prompt + CLAUDE.md + skills + prompt) is mostly "
          "written to cache (cache_creation), not read from it, so the second column is the real starting context; the first column "
          "is what the task asked for and reflects only the part that was already cached by the parent or a sibling.")

    # ---- orchestrator sessions
    W("\n### Main (orchestrator) sessions\n")
    orch = [s for s in sessions if s["agent_launches"]]
    plain = [s for s in sessions if not s["agent_launches"] and s["msgs"]]
    W(f"Sessions launching >= 1 Agent: {len(orch)}; other main sessions with assistant turns: {len(plain)}\n")
    if orch:
        W("| session | title | launches | tool calls | Bash | Read/Edit/Write | turns | dur | out chars | in+cache_read | cache_create | tool calls between launches (median / max) | before first | after last |")
        W("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        gaps_all = []
        for s in orch:
            tk = tokens(s)
            seq = s["tool_uses"]
            idx = [i for i, tu in enumerate(seq) if tu[5]]
            gaps = [idx[j+1] - idx[j] - 1 for j in range(len(idx)-1)]
            gaps_all.extend(gaps)
            before = idx[0] if idx else 0
            after = len(seq) - idx[-1] - 1 if idx else 0
            rew = s["tools"]["Read"] + s["tools"]["Edit"] + s["tools"]["Write"]
            W(f"| {s['id'][:8]} | {s['custom_title'] or '-'} | {len(s['agent_launches'])} | {sum(s['tools'].values())} | {s['tools']['Bash']} | {rew} | "
              f"{tk['turns']} | {fmt_dur(duration_s(s))} | {fmt_k(tk['out_chars'])} | {fmt_k(tk['input']+tk['cache_read'])} | {fmt_k(tk['cache_create'])} | "
              f"{median(gaps) if gaps else '-'} / {max(gaps) if gaps else '-'} | {before} | {after} |")
        W(f"\nAcross orchestrator sessions: Agent launches total {sum(len(s['agent_launches']) for s in orch)}; "
          f"tool calls between consecutive launches: median {median(gaps_all) if gaps_all else '-'}, p90 {p90(gaps_all) if gaps_all else '-'}, "
          f"launches with 0 tool calls before the next: {sum(1 for g in gaps_all if g == 0)}/{len(gaps_all)}")
        lt = Counter((l[1] or '?') for s in orch for l in s["agent_launches"])
        W(f"Launch subagent_type: {dict(lt)}")
        # cost-state: the harness's own per-session totals (API-reported usage), which
        # include the session's sub-agents. These are the reliable output-token numbers.
        W("\nSession totals from the harness `cost-state` record (API-reported usage for the whole session, sub-agents included):\n")
        W("| session | cost USD | API time | tool time | wall (harness) | output tok | cache_read | cache_create | input | models | transcript cache_read main+subs / cost-state cache_read | recorded output tok main+subs / cost-state output |")
        W("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for s in orch:
            cs = s["cost_state"]
            subs = [a for a in subagents if a["parent"] == s["id"]]
            tk_all = [tokens(s)] + [tokens(a) for a in subs]
            rec_cr = sum(t["cache_read"] + t["input"] for t in tk_all)
            rec_out = sum(t["output"] for t in tk_all)
            if not cs or not cs.get("modelUsage"):
                W(f"| {s['id'][:8]} | - | - | - | - | - | - | - | - | none | - | - |")
                continue
            mu = cs["modelUsage"]
            o = sum(v.get("outputTokens", 0) for v in mu.values())
            cr = sum(v.get("cacheReadInputTokens", 0) for v in mu.values())
            cc = sum(v.get("cacheCreationInputTokens", 0) for v in mu.values())
            inp = sum(v.get("inputTokens", 0) for v in mu.values())
            models = ", ".join(f"{m.replace('claude-','')} out {fmt_k(v.get('outputTokens',0))}" for m, v in mu.items())
            W(f"| {s['id'][:8]} | {cs.get('totalCostUSD',0):.2f} | {fmt_dur(cs.get('totalAPIDuration',0)/1000)} | {fmt_dur(cs.get('totalToolDuration',0)/1000)} | "
              f"{fmt_dur(cs.get('totalDuration',0)/1000)} | {fmt_k(o)} | {fmt_k(cr)} | {fmt_k(cc)} | {fmt_k(inp)} | {models} | "
              f"{rec_cr/cr:.2f} | {rec_out/o:.2f} |" if cr and o else f"| {s['id'][:8]} | {cs.get('totalCostUSD',0):.2f} | - | - | - | {fmt_k(o)} | {fmt_k(cr)} | {fmt_k(cc)} | {fmt_k(inp)} | {models} | - | - |")
        W("\nThe last two columns check the transcript against the harness totals: a cache_read ratio near 1.0 confirms that the transcript's input-side "
          "usage is complete and that cost-state covers the sub-agents; the output ratio shows how badly the per-record `output_tokens` undercounts.")
        W("\nOrchestrator tool calls by tool:\n")
        tools_o = Counter()
        for s in orch:
            tools_o.update(s["tools"])
        W("| tool | calls | share |")
        W("|---|---|---|")
        out.extend(bucket_table(tools_o, sum(tools_o.values())))
        W("\nOrchestrator Bash buckets:\n")
        prim = Counter()
        segs = Counter()
        scripts = Counter()
        for s in orch:
            prim.update(s["bash_primary"])
            segs.update(s["bash_segments"])
            scripts.update(s["script_names"])
        nb, ns = sum(prim.values()), sum(segs.values())
        W("| bucket | calls (primary) | share | segments | share |")
        W("|---|---|---|---|---|")
        for k in sorted(set(prim) | set(segs), key=lambda k: -(segs[k])):
            W(f"| {k} | {prim[k]} | {pct(prim[k], nb)} | {segs[k]} | {pct(segs[k], ns)} |")
        if scripts:
            W("\nOrchestrator repo scripts: " + ", ".join(f"{k} {v}" for k, v in scripts.most_common()))
        g = process_share(orch)
        tot = sum(g.values())
        W(f"\nOrchestrator process share: process {g['process']} ({pct(g['process'], tot)}), work {g['work']} ({pct(g['work'], tot)}), inspect/other {g['inspect/other']} ({pct(g['inspect/other'], tot)})")
        secs, calls, unmatched = time_by_bucket(orch)
        tot_s = sum(secs.values())
        W(f"\nOrchestrator wall time inside tool calls (matched {sum(calls.values()) - unmatched}/{sum(calls.values())}): {fmt_dur(tot_s)} total. "
          "Agent calls run in the background, so their tool time is the launch, not the sub-agent's run.\n")
        W("| bucket | calls | time | share | mean s/call |")
        W("|---|---|---|---|---|")
        for k, v in secs.most_common(12):
            W(f"| {k} | {calls[k]} | {fmt_dur(v)} | {pct(v, tot_s)} | {v/calls[k]:.0f} |")
    if plain:
        W("\nNon-orchestrator main sessions (no Agent launches), for contrast:\n")
        tools_p = Counter()
        prim = Counter()
        for s in plain:
            tools_p.update(s["tools"])
            prim.update(s["bash_primary"])
        tkp = [tokens(s) for s in plain]
        W(f"- {len(plain)} sessions, {sum(tools_p.values())} tool calls, median tool calls/session {median([sum(s['tools'].values()) for s in plain]):.0f}, "
          f"median duration {fmt_dur(median([duration_s(s) for s in plain]))}, assistant output chars total {fmt_k(sum(t['out_chars'] for t in tkp))}")
        cs_out = sum(sum(v.get('outputTokens', 0) for v in (s['cost_state'] or {}).get('modelUsage', {}).values()) for s in plain)
        cs_usd = sum((s['cost_state'] or {}).get('totalCostUSD', 0) for s in plain)
        W(f"- cost-state totals for these sessions: output tokens {fmt_k(cs_out)}, cost USD {cs_usd:.2f}")
        g = process_share(plain)
        tot = sum(g.values())
        W(f"- process share: process {g['process']} ({pct(g['process'], tot)}), work {g['work']} ({pct(g['work'], tot)}), inspect/other {g['inspect/other']} ({pct(g['inspect/other'], tot)})")
        W("- top Bash buckets: " + ", ".join(f"{k} {v}" for k, v in prim.most_common(8)))

    # ---- caveats
    W("\n### Caveats for this project\n")
    bad = sum(s["bad_json"] for s in sessions + subagents)
    W(f"- Records that failed JSON parsing: {bad}")
    W(f"- Bash calls whose primary segment could not be classified (bucket `other`): {sum(s['unclassified_bash'] for s in subagents)} in sub-agents, {sum(s['unclassified_bash'] for s in sessions)} in main sessions")
    oth = Counter()
    for s in sessions + subagents:
        for tu in s["tool_uses"]:
            if tu[1] == "Bash" and tu[2] == "other":
                oth[tu[3] or "?"] += 1
    if oth:
        W("- Unclassified command heads (top 12): " + ", ".join(f"`{k}` {v}" for k, v in oth.most_common(12)))
    W(f"- Records/commands with secret-like strings (redacted, never printed): {sum(s['secretish_records'] for s in sessions + subagents)}; "
      f"Bash commands mentioning `.env`: {sum(s['dotenv_cmds'] for s in sessions + subagents)} (contents never read by this script)")
    W("- `output_tokens` on assistant records is the count at the moment the record was persisted (mid-stream), e.g. 7 tokens on a record whose tool_use input is 9 kB; "
      "only end-of-turn records carry the final count. Per-transcript output tokens are therefore NOT measurable from these files; the report gives measured output "
      "characters instead, and the harness `cost-state` totals per main session (which include sub-agents) for real output-token counts.")
    W("- Input-side usage (input_tokens, cache_read, cache_creation) is known at request start and is consistent across the blocks of a message; those sums are reliable.")
    W("- Wall-clock durations include waiting: on permission prompts, on background tasks (Monitor/TaskStop), on the human. They are elapsed time, not model time.")
    W("- Role tags come from `.meta.json` agentType plus keywords in the description/prompt; `general-purpose` is left as-is when no keyword matched.")
    W(f"- Sub-agent transcripts in this project's sessions launched Agents themselves: {sum(a['tools'].get('Agent', 0) for a in subagents)} nested launches "
      f"(spawnDepth 2 transcripts are included in the sub-agent set).")
    if name.startswith("windsor"):
        W("- Session 35dbdc79 is the session that ran this measurement; its sub-agent transcripts (including the measuring agent's own) were still being written when read.")


def main():
    require_hide_table(HIDE_TABLE)
    out = []
    out.append("# Sub-agent tool-call and token overhead, measured from Claude Code transcripts")
    out.append(f"\nGenerated {datetime.now().isoformat(timespec='seconds')} by measure-overhead.py from `{BASE}`. "
               "All numbers are counted from the jsonl records; nothing is estimated. Token sums dedupe assistant records by `message.id` "
               "(the transcript stores one record per content block, repeating the same usage).")
    schema_notes = [
        "Schema as found: main session = `<project>/<uuid>.jsonl`; sub-agent = `<project>/<uuid>/subagents/agent-<id>.jsonl` plus `agent-<id>.meta.json` "
        "(agentType, description, toolUseId, spawnDepth, isFork). Sub-agent records have `isSidechain: true` and `agentId`; none are stored inline in the parent file.",
        "Fields present: `type`, `timestamp`, `message.role/content/usage/id/model`, `requestId`, `toolUseResult`, `cwd`, `version`, `gitBranch`. "
        "No `parentAgentId` field exists; the link to the launching Agent tool_use is `meta.toolUseId`.",
        "Wall-clock duration = first to last record timestamp in the transcript file.",
        "Bash classification splits each command into shell segments (heredoc bodies removed) and reports both the first informative segment per call "
        "(`primary`) and all segments; python/node heredocs are their own buckets, with `python-inline:edit` when the body writes a file.",
    ]
    for n in schema_notes:
        out.append(f"- {n}")
    for name, dirs in PROJECTS.items():
        sessions, subagents = collect(dirs)
        report_project(name, sessions, subagents, out)
    for name, dirs in EXTRA_DIRS.items():
        sessions, subagents = collect(dirs)
        out.append(f"\n## Note: {name}\n")
        tk = [tokens(s) for s in sessions]
        out.append(f"- {len(sessions)} session(s), {len(subagents)} sub-agent transcripts, {sum(sum(s['tools'].values()) for s in sessions)} tool calls, "
                   f"date range {min(ts for s in sessions for ts in s['ts']).date() if any(s['ts'] for s in sessions) else '-'}; "
                   f"output tokens {fmt_k(sum(t['output'] for t in tk))}. Not included in the Aotearoa204 totals above.")
    text = "\n".join(out) + "\n"
    sys.stdout.write(text)
    with open(os.path.join(HERE, "transcript-overhead-report.md"), "w") as fh:
        fh.write(text)


def self_test():
    """Check hide_words on a made-up word: every case and form goes, longer words stay."""
    table = hide_table({"REPORT_HIDE_WORDS": "Zorbl, Qux", "REPORT_HIDE_WITH": "someone"})
    got = hide_words("Zorbl said; zorbl's mix; ZORBLS idea; run-zorbl-now; Zorblax and quxes stay.", table)
    want = "someone said; someone's mix; someone's idea; run-someone-now; Zorblax and quxes stay."
    assert got == want, f"got {got!r}"
    assert hide_table({}) == [], "no words means nothing hidden"
    try:
        require_hide_table(hide_table({}))
    except SystemExit:
        pass
    else:
        raise AssertionError("an empty word list must stop the report")
    require_hide_table(table)
    assert hide_words("unchanged", []) == "unchanged"
    print("self-test passed")


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        self_test()
    else:
        main()
