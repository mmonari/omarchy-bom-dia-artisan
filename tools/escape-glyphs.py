#!/usr/bin/env python3
"""Rewrite private-use / astral glyphs in source files as JS escapes, in place.

Nerd Font codepoints are private-use characters, and several tools between an
editor and disk silently unescape them. This turns any that slipped through
back into ASCII escapes (surrogate pairs above U+FFFF) and exits 1 if it had
to change anything, so it doubles as a check: `tools/escape-glyphs.py --check`.
"""
import sys, pathlib

def esc(cp):
    if cp > 0xFFFF:
        v = cp - 0x10000
        return "\\u%04X" % (0xD800 + (v >> 10)) + "\\u%04X" % (0xDC00 + (v & 0x3FF))
    return "\\u%04X" % cp

def bad(c):
    o = ord(c)
    return 0xE000 <= o <= 0xF8FF or 0xF0000 <= o <= 0x10FFFF

check = "--check" in sys.argv
files = [a for a in sys.argv[1:] if not a.startswith("--")] or [
    str(p) for p in pathlib.Path(".").glob("*") if p.suffix in (".js", ".qml")]
dirty = []
for f in files:
    s = pathlib.Path(f).read_text(encoding="utf8")
    if any(bad(c) for c in s):
        dirty.append(f)
        if not check:
            pathlib.Path(f).write_text("".join(esc(ord(c)) if bad(c) else c for c in s), encoding="utf8")
for f in dirty:
    print(("literal glyphs in " if check else "escaped glyphs in ") + f)
sys.exit(1 if dirty else 0)
