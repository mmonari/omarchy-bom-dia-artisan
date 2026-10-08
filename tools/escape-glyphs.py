#!/usr/bin/env python3
"""Rewrite private-use / astral glyphs in source files as JS escapes, in place.

Nerd Font codepoints are private-use characters, and several tools between an
editor and disk silently unescape them. This turns any that slipped through
back into ASCII escapes (surrogate pairs above U+FFFF) and exits 1 if it had
to change anything, so it doubles as a check: `tools/escape-glyphs.py --check`.

With no file arguments it scans every .js/.mjs/.qml in the repo (found from
this file's location, not the cwd), skipping SKIP. Only JS-family files: the
escapes it writes are JS syntax, and wrong in Python or Markdown.
"""
import os, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Same scope as the "no literal Nerd Font glyphs" test in test/source.test.mjs.
# Change both together.
SUFFIXES = (".js", ".mjs", ".qml")
SKIP = {"node_modules", ".git", "test/fixtures"}  # directories, relative to ROOT

def sources():
    out = []
    for d, dirs, names in os.walk(ROOT):
        rel = pathlib.Path(d).relative_to(ROOT)
        dirs[:] = sorted(x for x in dirs if (rel / x).as_posix() not in SKIP)
        out += [(rel / n).as_posix() for n in sorted(names) if n.endswith(SUFFIXES)]
    return out

def esc(cp):
    if cp > 0xFFFF:
        v = cp - 0x10000
        return "\\u%04X" % (0xD800 + (v >> 10)) + "\\u%04X" % (0xDC00 + (v & 0x3FF))
    return "\\u%04X" % cp

def bad(c):
    o = ord(c)
    return 0xE000 <= o <= 0xF8FF or 0xF0000 <= o <= 0x10FFFF

check = "--check" in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith("--")]
# (name to report, path to open): explicit files resolve against the cwd as before.
files = [(a, pathlib.Path(a)) for a in args] or [(f, ROOT / f) for f in sources()]
dirty = []
for f, path in files:
    s = path.read_text(encoding="utf8")
    if any(bad(c) for c in s):
        dirty.append(f)
        if not check:
            path.write_text("".join(esc(ord(c)) if bad(c) else c for c in s), encoding="utf8")
for f in dirty:
    print(("literal glyphs in " if check else "escaped glyphs in ") + f)
sys.exit(1 if dirty else 0)
