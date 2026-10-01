"""Build a research copy of the FM worklet bundle with per-operator noise colour (windsor#318, windsor#361).

    python build.py [OUT_DIR] [--poles 1|2]     build a mirror, then self-check it
    python build.py --check OUT_DIR             self-check an existing mirror

Not shipping code. It copies `packages/engine/src/worklet/generated/fm-processor.js`
into a mirror of the sound-match toolkit under OUT_DIR (default
`<tmp>/sound-match/noise-colour-<poles>p/`) and patches the copy, so the
toolkit's own `render.mjs`, `fit.py` and `compare.py` run against it unchanged:

    OUT_DIR/packages/engine/src/worklet/generated/fm-processor.js   the patched copy
    OUT_DIR/packages/engine/src/patches/   a copy of the repository's patches
    OUT_DIR/scripts/sound-match/           a copy of the toolkit

Then, from OUT_DIR/scripts/sound-match/, `python fit.py <spec>` and
`python compare.py <ref> <patch>` work as in the repository.

Everything is copied, never symlinked (windsor#361). Python puts a script's
real directory first on `sys.path`, so a symlinked `fit.py` imports the
repository's `renderer.py`, which renders through the repository's
`render.mjs` and the shipped bundle, and the new fields are silently
ignored. The self-check catches that layout: it runs the mirror's own
`compare.py` on a patch with `noiseLp` set and on the same patch without it,
and fails if the two score the same.

The change: a Noise operator takes two new fields, `noiseLp` and `noiseHp`
(Hz; 0 or absent is off), a lowpass and a highpass on that operator's own
noise, before its level and envelope. `--poles 1` (the windsor#318 prototype)
makes them one-pole (topology-preserving, tan-prewarped, 6 dB/oct);
`--poles 2` makes them two-pole state-variable filters (the same TPT form
as the voice's `Svf`, 12 dB/oct) and adds `noiseLpQ` and `noiseHpQ`, each
filter's resonance (Q, at least 0.5; 0 or absent is Butterworth, Q 0.707).
A patch without the
fields renders bit for bit as the shipped bundle does: the filters are
skipped and the noise sequence is unchanged (the self-check also checks
this). The coefficients are set once per note; there is no smoothing and no
portability work (Math.tan): it is a prototype for measuring, not the engine
change itself.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
BUNDLE_REL = os.path.join('packages', 'engine', 'src', 'worklet', 'generated', 'fm-processor.js')
PATCHES_REL = os.path.join('packages', 'engine', 'src', 'patches')
TOOLKIT_REL = os.path.join('scripts', 'sound-match')

# The self-check's patch and the noise lowpass it sets on that patch's Noise operator.
CHECK_PATCH = 'tr909-tom-mid'
CHECK_SEED = 3
CHECK_LP_HZ = 2000
NOISE_WAVE = 4

# The filter state and coefficients, preallocated in the voice's constructor.
ALLOCATE = (
    '    this.opWidth = new Float64Array(4).fill(1);\n',
    '    this.opWidth = new Float64Array(4).fill(1);\n'
    '    this.nzLpG = new Float64Array(4);\n'
    '    this.nzHpG = new Float64Array(4);\n'
    '    this.nzLpS = new Float64Array(4);\n'
    '    this.nzHpS = new Float64Array(4);\n'
    '    this.nzLpA1 = new Float64Array(4);\n'
    '    this.nzLpA2 = new Float64Array(4);\n'
    '    this.nzLpA3 = new Float64Array(4);\n'
    '    this.nzHpA1 = new Float64Array(4);\n'
    '    this.nzHpA2 = new Float64Array(4);\n'
    '    this.nzHpA3 = new Float64Array(4);\n'
    '    this.nzLp1 = new Float64Array(4);\n'
    '    this.nzLp2 = new Float64Array(4);\n'
    '    this.nzHp1 = new Float64Array(4);\n'
    '    this.nzHp2 = new Float64Array(4);\n',
    1,
)
# The two-pole highpass's damping, per operator (its lowpass's is folded into the coefficients).
ALLOCATE_TWO_POLE = '    this.nzHpK = new Float64Array(4);\n'

# windsor#318's one-pole pair: y = s + (x - s)g, s' = y + (x - s)g.
ONE_POLE = (
    '  /** windsor#318 prototype: the noise colour\'s coefficients for operator i, and its state from rest. */\n'
    '  colourNoise(i, op) {\n'
    '    this.nzLpG[i] = this.onePoleG(op.noiseLp);\n'
    '    this.nzHpG[i] = this.onePoleG(op.noiseHp);\n'
    '    this.nzLpS[i] = 0;\n'
    '    this.nzHpS[i] = 0;\n'
    '  }\n'
    '  onePoleG(hz) {\n'
    '    if (!(hz > 0)) return 0;\n'
    '    const t = Math.tan(Math.PI * Math.min(hz, 0.45 * this.sr) / this.sr);\n'
    '    return t / (1 + t);\n'
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
)

# windsor#361's two-pole pair: the voice's Svf in its TPT form. Damping k = 1/Q from `noiseLpQ` / `noiseHpQ`
# (clamped to Q >= 0.5); 0 or absent is Butterworth, k = sqrt(2).
TWO_POLE = (
    '  /** windsor#361 prototype: the noise colour\'s coefficients for operator i, and its state from rest. */\n'
    '  colourNoise(i, op) {\n'
    '    const lg = this.svfG(op.noiseLp);\n'
    '    const hg = this.svfG(op.noiseHp);\n'
    '    this.nzLpG[i] = lg;\n'
    '    this.nzHpG[i] = hg;\n'
    '    const lk = op.noiseLpQ > 0 ? 1 / Math.max(0.5, op.noiseLpQ) : Math.SQRT2;\n'
    '    const hk = op.noiseHpQ > 0 ? 1 / Math.max(0.5, op.noiseHpQ) : Math.SQRT2;\n'
    '    this.nzHpK[i] = hk;\n'
    '    this.nzLpA1[i] = 1 / (1 + lg * (lg + lk));\n'
    '    this.nzLpA2[i] = lg * this.nzLpA1[i];\n'
    '    this.nzLpA3[i] = lg * this.nzLpA2[i];\n'
    '    this.nzHpA1[i] = 1 / (1 + hg * (hg + hk));\n'
    '    this.nzHpA2[i] = hg * this.nzHpA1[i];\n'
    '    this.nzHpA3[i] = hg * this.nzHpA2[i];\n'
    '    this.nzLp1[i] = 0;\n'
    '    this.nzLp2[i] = 0;\n'
    '    this.nzHp1[i] = 0;\n'
    '    this.nzHp2[i] = 0;\n'
    '  }\n'
    '  svfG(hz) {\n'
    '    if (!(hz > 0)) return 0;\n'
    '    return Math.tan(Math.PI * Math.min(hz, 0.45 * this.sr) / this.sr);\n'
    '  }\n'
    '  /** windsor#361 prototype: operator i\'s noise through its own two-pole lowpass and highpass. */\n'
    '  noiseOp(i) {\n'
    '    let x = this.noise();\n'
    '    if (this.nzLpG[i] > 0) {\n'
    '      const ic1 = this.nzLp1[i];\n'
    '      const ic2 = this.nzLp2[i];\n'
    '      const v3 = x - ic2;\n'
    '      const v1 = this.nzLpA1[i] * ic1 + this.nzLpA2[i] * v3;\n'
    '      const v2 = ic2 + this.nzLpA2[i] * ic1 + this.nzLpA3[i] * v3;\n'
    '      this.nzLp1[i] = 2 * v1 - ic1;\n'
    '      this.nzLp2[i] = 2 * v2 - ic2;\n'
    '      x = v2;\n'
    '    }\n'
    '    if (this.nzHpG[i] > 0) {\n'
    '      const ic1 = this.nzHp1[i];\n'
    '      const ic2 = this.nzHp2[i];\n'
    '      const v3 = x - ic2;\n'
    '      const v1 = this.nzHpA1[i] * ic1 + this.nzHpA2[i] * v3;\n'
    '      const v2 = ic2 + this.nzHpA2[i] * ic1 + this.nzHpA3[i] * v3;\n'
    '      this.nzHp1[i] = 2 * v1 - ic1;\n'
    '      this.nzHp2[i] = 2 * v2 - ic2;\n'
    '      x = x - this.nzHpK[i] * v1 - v2;\n'
    '    }\n'
    '    return x;\n'
    '  }\n'
)


def edits(poles):
    """(anchor in the shipped bundle, replacement, count); each anchor must occur exactly `count` times."""
    methods = ONE_POLE if poles == 1 else TWO_POLE
    resonance = '    noiseLpQ: num(o.noiseLpQ, 0),\n    noiseHpQ: num(o.noiseHpQ, 0),\n'
    return [
        (
            '    userPartials: o.userPartials || d.userPartials,\n',
            '    userPartials: o.userPartials || d.userPartials,\n'
            '    noiseLp: num(o.noiseLp, 0),\n'
            '    noiseHp: num(o.noiseHp, 0),\n'
            + (resonance if poles == 2 else ''),
            1,
        ),
        (ALLOCATE[0], ALLOCATE[1] + (ALLOCATE_TWO_POLE if poles == 2 else ''), ALLOCATE[2]),
        (
            '      this.ampBreak[i] = 0;\n      this.kind[i] = waveKind(op.wave);\n',
            '      this.ampBreak[i] = 0;\n      this.kind[i] = waveKind(op.wave);\n'
            '      this.colourNoise(i, op);\n',
            1,
        ),
        ('  noise() {\n', methods + '  noise() {\n', 1),
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


def fresh(dst):
    """Remove whatever is at dst: a file, a symlink or a folder."""
    if os.path.islink(dst) or os.path.isfile(dst):
        os.remove(dst)
    elif os.path.isdir(dst):
        shutil.rmtree(dst)


def build(out, poles):
    src = open(os.path.join(REPO, BUNDLE_REL)).read()
    for anchor, repl, count in edits(poles):
        found = src.count(anchor)
        if found != count:
            sys.exit(f'anchor found {found} times, expected {count}: {anchor!r}')
        src = src.replace(anchor, repl)
    gen = os.path.dirname(os.path.join(out, BUNDLE_REL))
    os.makedirs(gen, exist_ok=True)
    with open(os.path.join(out, BUNDLE_REL), 'w') as f:
        f.write(src)
    patches = os.path.join(out, PATCHES_REL)
    fresh(patches)
    shutil.copytree(os.path.join(REPO, PATCHES_REL), patches)
    sm = os.path.join(out, TOOLKIT_REL)
    fresh(sm)
    shutil.copytree(os.path.join(REPO, TOOLKIT_REL), sm, ignore=shutil.ignore_patterns('__pycache__'))
    print(f'{poles}-pole research bundle and toolkit mirror in {out}')


def check_patches(work):
    """The check patch without the fields and with `noiseLp` on its Noise operator, as files in `work`."""
    with open(os.path.join(REPO, PATCHES_REL, f'{CHECK_PATCH}.json')) as f:
        plain = json.load(f)['patch']
    noise_ops = [i for i, op in enumerate(plain['ops']) if op.get('wave') == NOISE_WAVE]
    if not noise_ops:
        sys.exit(f'self-check: {CHECK_PATCH} has no Noise operator')
    coloured = json.loads(json.dumps(plain))
    coloured['ops'][noise_ops[0]]['noiseLp'] = CHECK_LP_HZ
    paths = {}
    for name, patch in (('plain', plain), ('coloured', coloured)):
        paths[name] = os.path.join(work, f'{name}.json')
        with open(paths[name], 'w') as f:
            json.dump(patch, f)
    return paths


def render(root, patch, wav):
    """One render of `patch` through `root`'s render.mjs, as bytes."""
    mjs = os.path.join(root, TOOLKIT_REL, 'render.mjs')
    subprocess.run(['node', mjs, patch, '--seed', str(CHECK_SEED), '--out', wav], check=True, capture_output=True)
    with open(wav, 'rb') as f:
        return f.read()


def compare_total(out, ref, patch, work, name):
    """The mirror's own compare.py, run as the fits run it: the candidate's total against `ref`."""
    report = os.path.join(work, f'{name}.compare.json')
    subprocess.run(
        [sys.executable, os.path.join(out, TOOLKIT_REL, 'compare.py'), ref, patch, '--seeds', '1',
         '--seed-base', str(CHECK_SEED), '--json', report],
        check=True, capture_output=True, cwd=os.path.join(out, TOOLKIT_REL),
    )
    with open(report) as f:
        return json.load(f)[0]['scores']['total']['mean']


def self_check(out):
    """Fail unless the mirror renders noiseLp through its own bundle, and a patch without it as shipped."""
    linked = [n for n in os.listdir(os.path.join(out, TOOLKIT_REL)) if os.path.islink(os.path.join(out, TOOLKIT_REL, n))]
    with tempfile.TemporaryDirectory() as work:
        paths = check_patches(work)
        shipped = render(REPO, paths['plain'], os.path.join(work, 'shipped.wav'))
        mirrored = render(out, paths['plain'], os.path.join(work, 'mirror-plain.wav'))
        ref = os.path.join(work, 'mirror-plain.wav')
        plain = compare_total(out, ref, paths['plain'], work, 'plain')
        coloured = compare_total(out, ref, paths['coloured'], work, 'coloured')
    failures = []
    if linked:
        failures.append(f'toolkit entries are symlinks: {", ".join(sorted(linked))}')
    if shipped != mirrored:
        failures.append(f'{CHECK_PATCH} without the fields does not render bit for bit as the shipped bundle')
    if coloured == plain:
        failures.append(f'{CHECK_PATCH} with noiseLp {CHECK_LP_HZ} Hz scores exactly as without it ({plain:.6f}) '
                        'through the mirror\'s compare.py: the fields are ignored')
    if failures:
        sys.exit('self-check FAILED:\n  ' + '\n  '.join(failures))
    print(f'self-check passed: without the fields bit for bit as shipped; through compare.py, '
          f'noiseLp {CHECK_LP_HZ} Hz scores {coloured:.4f} against {plain:.4f} without it')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out', nargs='?')
    ap.add_argument('--poles', type=int, choices=(1, 2), default=1)
    ap.add_argument('--check', action='store_true', help='only self-check the mirror at OUT_DIR')
    a = ap.parse_args()
    out = a.out or os.path.join(tempfile.gettempdir(), 'sound-match', f'noise-colour-{a.poles}p')
    out = os.path.abspath(out)
    if not a.check:
        build(out, a.poles)
    self_check(out)


if __name__ == '__main__':
    main()
