# BL-001 — Make the glyph check scan subfolders

- **Status:** ✅ Done — see changelogs/2026-10-08.md
- **Priority:** Low — what the shell loads is all top-level and already checked; a miss in a
  subfolder changes how a test's pattern reads, not what users see
- **Scope:** tooling · tests (`tools/escape-glyphs.py`, `test/source.test.mjs`)
- **Summary:** Widen both glyph guards (the `--check` tool and the "no literal glyphs" test) from
  top-level files to every `.js`/`.mjs`/`.qml` in the repo, skipping `node_modules/`, `.git/` and
  `test/fixtures/`.

## Context

Both guards read only the repo root:

- `tools/escape-glyphs.py` with no file arguments: `pathlib.Path(".").glob("*")` filtered to
  `.js`/`.qml`.
- `test/source.test.mjs`, "no literal Nerd Font glyphs in any source file":
  `readdirSync(ROOT).filter((f) => /\.(js|qml)$/.test(f))`.

`test/source.test.mjs`'s own regex carried literal private-use characters from the first commit
(`ec222a5`) until `fa6380c`. No check caught them; a parallel agent found them by running the
tool on that file by hand.

## Approach

- Recurse in both guards over `.js`, `.mjs` and `.qml`, skipping `node_modules/`, `.git/` and
  `test/fixtures/` (the fixture is the site's data, not source).
- Do **not** include `.py` or `.md`: rewrite mode writes *JS* escapes, and surrogate-pair escapes
  above U+FFFF mean lone surrogates in Python and are garbage in Markdown.
- Keep the two guards' file lists the same, so they can't drift apart again.
- Prove the check bites: plant a literal U+F058 in a throwaway `test/tmp-glyph.mjs` (written by a
  Python byte write, since the Write tool and heredocs mangle escapes), run `--check` and
  `npm test`, confirm both fail and name the file, then delete it.

## Acceptance

- `tools/escape-glyphs.py --check` and `npm test` fail when a literal PUA glyph is present in any
  `.js`/`.mjs`/`.qml` under `test/` or another subfolder, and pass on the clean tree.
- `npm test` passes in the pinned zone and with `TZ=Asia/Tokyo` / `TZ=UTC`.
- README and CLAUDE.md describe the wider scope.

## Links

- Changelog: changelogs/2026-10-08.md (late-day probe section) · Lessons: lessons-learned/omarchy-plugins.md
  ("A glyph check that scans only top-level files misses the tests")
