"""Build a research copy of the FM worklet bundle with per-operator noise colour (windsor#318).

    python build.py [OUT_DIR]

Not shipping code. It copies `packages/engine/src/worklet/generated/fm-processor.js`
into a mirror of the sound-match toolkit under OUT_DIR (default
`<tmp>/sound-match/noise-colour/`) and patches the copy, so the toolkit's own
`render.mjs`, `fit.py` and `compare.py` run against it unchanged:

    OUT_DIR/packages/engine/src/worklet/generated/fm-processor.js   the patched copy
    OUT_DIR/packages/engine/src/patches -> the repository's patches
    OUT_DIR/scripts/sound-match/   the toolkit (render.mjs copied, the rest linked)

Then, from OUT_DIR/scripts/sound-match/, `python fit.py <spec>` and
`python compare.py <ref> <patch>` work as in the repository.

The change: a Noise operator takes two new fields, `noiseLp` and `noiseHp`
(Hz; 0 or absent is off), a one-pole lowpass and a one-pole highpass
(topology-preserving, tan-prewarped) on that operator's own noise, before
its level and envelope. A patch without them renders bit for bit as the
shipped bundle does: the filters are skipped and the noise sequence is
unchanged. The coefficients are set once per note; there is no smoothing,
no allocation in the loops, and no portability work (Math.tan): it is a
prototype for measuring, not the engine change itself.
"""

import os
import shutil
import sys
import tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
BUNDLE = os.path.join(REPO, 'packages', 'engine', 'src', 'worklet', 'generated', 'fm-processor.js')
TOOLKIT = os.path.join(REPO, 'scripts', 'sound-match')

# (anchor in the shipped bundle, replacement); each anchor must occur exactly `count` times.
EDITS = [
    (
        '    userPartials: o.userPartials || d.userPartials,\n',
        '    userPartials: o.userPartials || d.userPartials,\n'
        '    noiseLp: num(o.noiseLp, 0),\n'
        '    noiseHp: num(o.noiseHp, 0),\n',
        1,
    ),
    (
        '      this.ampBreak[i] = 0;\n      this.kind[i] = waveKind(op.wave);\n',
        '      this.ampBreak[i] = 0;\n      this.kind[i] = waveKind(op.wave);\n'
        '      this.colourNoise(i, op);\n',
        1,
    ),
    (
        '  noise() {\n',
        '  /** windsor#318 prototype: the noise colour\'s coefficients for operator i, and its state from rest. */\n'
        '  colourNoise(i, op) {\n'
        '    if (!this.nzLpG) {\n'
        '      this.nzLpG = new Float64Array(4);\n'
        '      this.nzHpG = new Float64Array(4);\n'
        '      this.nzLpS = new Float64Array(4);\n'
        '      this.nzHpS = new Float64Array(4);\n'
        '    }\n'
        '    const g = (hz) => {\n'
        '      if (!(hz > 0)) return 0;\n'
        '      const t = Math.tan(Math.PI * Math.min(hz, 0.45 * this.sr) / this.sr);\n'
        '      return t / (1 + t);\n'
        '    };\n'
        '    this.nzLpG[i] = g(op.noiseLp);\n'
        '    this.nzHpG[i] = g(op.noiseHp);\n'
        '    this.nzLpS[i] = 0;\n'
        '    this.nzHpS[i] = 0;\n'
        '  }\n'
        '  /** windsor#318 prototype: operator i\'s noise through its own one-pole lowpass and highpass. */\n'
        '  noiseOp(i) {\n'
        '    let x = this.noise();\n'
        '    const lg = this.nzLpG[i];\n'
        '    if (lg > 0) {\n'
        '      const s = this.nzLpS[i];\n'
        '      const v = (x - s) * lg;\n'
        '      const y = v + s;\n'
        '      this.nzLpS[i] = y + v;\n'
        '      x = y;\n'
        '    }\n'
        '    const hg = this.nzHpG[i];\n'
        '    if (hg > 0) {\n'
        '      const s = this.nzHpS[i];\n'
        '      const v = (x - s) * hg;\n'
        '      const y = v + s;\n'
        '      this.nzHpS[i] = y + v;\n'
        '      x -= y;\n'
        '    }\n'
        '    return x;\n'
        '  }\n'
        '  noise() {\n',
        1,
    ),
    ('kD === KIND_NOISE) v = voice.noise();', 'kD === KIND_NOISE) v = voice.noiseOp(D);', 1),
    ('kC === KIND_NOISE) v = voice.noise();', 'kC === KIND_NOISE) v = voice.noiseOp(C);', 1),
    ('kB === KIND_NOISE) v = voice.noise();', 'kB === KIND_NOISE) v = voice.noiseOp(B);', 1),
    ('kA === KIND_NOISE) v = voice.noise();', 'kA === KIND_NOISE) v = voice.noiseOp(A);', 1),
    (
        '          case KIND_NOISE:\n            v = voice.noise();\n',
        '          case KIND_NOISE:\n            v = voice.noiseOp(i);\n',
        1,
    ),
]


def build(out):
    src = open(BUNDLE).read()
    for anchor, repl, count in EDITS:
        found = src.count(anchor)
        if found != count:
            sys.exit(f'anchor found {found} times, expected {count}: {anchor!r}')
        src = src.replace(anchor, repl)
    gen = os.path.join(out, 'packages', 'engine', 'src', 'worklet', 'generated')
    os.makedirs(gen, exist_ok=True)
    with open(os.path.join(gen, 'fm-processor.js'), 'w') as f:
        f.write(src)
    patches = os.path.join(out, 'packages', 'engine', 'src', 'patches')
    if not os.path.lexists(patches):
        os.symlink(os.path.join(REPO, 'packages', 'engine', 'src', 'patches'), patches)
    sm = os.path.join(out, 'scripts', 'sound-match')
    os.makedirs(sm, exist_ok=True)
    for name in os.listdir(TOOLKIT):
        dst = os.path.join(sm, name)
        if os.path.lexists(dst):
            os.remove(dst)
        if name == 'render.mjs':
            shutil.copy(os.path.join(TOOLKIT, name), dst)
        elif name.endswith('.py') or name == 'specs':
            os.symlink(os.path.join(TOOLKIT, name), dst)
    print(f'research bundle and toolkit mirror in {out}')


if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), 'sound-match', 'noise-colour'))
