"""The Python side of `render.mjs --server`: one Node process for many renders.

Requests go out as JSON lines; each answer is a JSON line followed by the
samples as little-endian float32. Node's start-up is paid once per Renderer.
"""

import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts; the repo does not ignore it

import json
import os
import subprocess
import time

import numpy as np

import constants as C

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER_MJS = os.path.join(HERE, "render.mjs")
PATCHES = os.path.normpath(os.path.join(HERE, "..", "..", "packages", "engine", "src", "patches"))


def load_patch(source, base_dir=None):
    """A bare patch dict from a library id, a library or bare JSON file, or a dict."""
    if isinstance(source, dict):
        return source.get("patch", source)
    path = os.path.expanduser(os.path.expandvars(source))
    if base_dir and not os.path.isabs(path) and not os.path.exists(path):
        path = os.path.join(base_dir, path)
    if not os.path.exists(path):
        path = os.path.join(PATCHES, f"{source}.json")
    with open(path) as f:
        parsed = json.load(f)
    return parsed.get("patch", parsed)


class Renderer:
    """A running `render.mjs --server`. Use as a context manager."""

    def __init__(self, node=None):
        node = node or os.environ.get("SOUND_MATCH_NODE", "node")
        self.proc = subprocess.Popen(
            [node, RENDER_MJS, "--server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
        )
        self.renders = 0
        self.seconds_rendering = 0.0

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        if self.proc.poll() is None:
            self.proc.stdin.close()
            self.proc.wait()

    def render(self, patch, note=60, velocity=1.0, seconds=1.0, gate=None, seed=C.SEED_BASE):
        """One note of `patch` as float64 samples at 48 kHz."""
        request = dict(patch=patch, note=note, velocity=velocity, seconds=seconds, gate=gate, seed=seed)
        started = time.perf_counter()
        self.proc.stdin.write((json.dumps(request) + "\n").encode())
        self.proc.stdin.flush()
        header = json.loads(self.proc.stdout.readline())
        if not header.get("ok"):
            raise RuntimeError(f"render failed: {header.get('error')}")
        raw = self.proc.stdout.read(header["frames"] * 4)
        self.seconds_rendering += time.perf_counter() - started
        self.renders += 1
        return np.frombuffer(raw, dtype="<f4").astype(np.float64)

    @property
    def rate(self):
        """Renders per second of wall time spent waiting on renders so far."""
        return self.renders / self.seconds_rendering if self.seconds_rendering else float("nan")


def bench():
    """`python renderer.py [patch] [--seconds 1] [--count 200]`: renders per second through the server."""
    import argparse

    ap = argparse.ArgumentParser(description=bench.__doc__)
    ap.add_argument("patch", nargs="?", default="tr909-kick")
    ap.add_argument("--seconds", type=float, default=1.0)
    ap.add_argument("--count", type=int, default=200)
    ap.add_argument("--warmup", type=int, default=20)
    args = ap.parse_args()
    patch = load_patch(args.patch)
    started = time.perf_counter()
    with Renderer() as r:
        r.render(patch, seconds=args.seconds)
        first = time.perf_counter() - started
        for i in range(args.warmup):
            r.render(patch, seconds=args.seconds, seed=i + 1)
        r.renders, r.seconds_rendering = 0, 0.0
        for i in range(args.count):
            r.render(patch, seconds=args.seconds, seed=i + 1)
        rate = r.rate
    print(f"{args.patch}, {args.seconds:g} s per render: first render (with Node start-up) {first * 1000:.0f} ms;")
    print(f"then {rate:.1f} renders/s over {args.count} renders, {rate * args.seconds:.0f}x real time")


if __name__ == "__main__":
    bench()
