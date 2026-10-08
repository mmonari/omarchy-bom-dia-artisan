# Lessons Learned — Tooling

> Accumulated, dated lessons on shell and dev tooling. Newest first.

## 2026-10-08 — `pkill -f <pattern>` can match the shell that runs it
- **Context:** Stopping a temporary `python3 -m http.server 47811` with
  `pkill -f "http.server 47811"` killed the Bash tool's own shell (exit 144). The command line of
  that shell contained the same string.
- **Lesson:** With `-f`, pgrep/pkill match the *full* command line of every process, including
  the shell running the kill. Write the pattern so it cannot match itself.
- **Why it matters:** Commands chained after the kill never run, and it looks like the server or
  tool failed.
- **How to apply:** Use the bracket trick, `pkill -f "http.server 4781[1]"` (the regex matches
  `47811`, but the literal text `4781[1]` does not), or kill by a saved PID (`$!`).
- **Refs:** changelog 2026-10-08 (architecture diagram)
- **Scope:** generic
- **Versions:** none

## 2026-10-08 — A diagram validator that passes can still overflow text
- **Context:** `archify validate` / `check` reported ok, but two sublabels ran outside their
  boxes. The validator checks overlap and geometry, not text width.
- **Lesson:** After any label change, look at a rendered screenshot.
- **Why it matters:** The overflow ships in the README-facing SVG.
- **How to apply:** Monospace 9 px is about 5.4 px per character, so a 140–150 px box fits about
  22 characters. Playwright MCP blocks `file:` URLs: serve the folder with
  `python3 -m http.server --bind 127.0.0.1`, screenshot, and trigger the page's own export
  (`page.waitForEvent('download')` + `dl.saveAs(...)`).
- **Refs:** `docs/architecture/`
- **Scope:** generic
- **Versions:** none
