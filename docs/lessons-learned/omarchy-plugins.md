# Lessons Learned — Omarchy / Quickshell plugin authoring

> Accumulated, dated lessons on writing third-party bar widgets. Newest first.
> See also `omarchy-backup-status/docs/lessons-learned/omarchy-plugins.md`.

## 2026-10-08 — A daily schedule is a wall-clock check, never a long QML Timer
- **Context:** The "once a day at 09:30" check had to work on a desktop that suspends overnight.
- **Lesson:** QML `Timer` runs on a monotonic clock that stops during suspend. A timer armed in
  the evening for 09:30 fires hours late after a night of sleep. Keep a pure
  `checkDue({nowMs, checkAt, hasToday, lastAttemptMs, failures})` and ask it from a 60 s
  repeating tick.
- **Why it matters:** The morning check silently drifts to whenever the machine has been awake
  long enough.
- **How to apply:** `Source.checkDue()` plus `maybeCheck()` on the minute tick, run only once the
  cache has been read, so a fresh start does not refetch what is already cached. Unit-test it
  with local `new Date(y, m, d, h, min)` times.
- **Refs:** `Source.js`, `BarWidget.qml`, `test/source.test.mjs`, changelog 2026-10-08
- **Scope:** stack
- **Versions:** none

## 2026-10-08 — Layer-shell panels can't be driven by synthetic input
- **Context:** Verifying keyboard navigation and hover states in the panel.
- **Lesson:** `wtype` key events never reach a layer-shell surface. In Lua-config Hyprland,
  a pointer warp (`hyprctl dispatch 'hl.dsp.cursor.move({x=…,y=…})'`) moves the cursor but
  delivers no hover to the panel. The old `hyprctl dispatch movecursor x y` syntax is rejected
  outright.
- **Why it matters:** The screenshot shows an un-hovered, unmoved panel, which reads as "the
  feature is broken" when it is the test harness.
- **How to apply:** For view state, add a temporary IPC method that finds the *opened* peer and
  calls the panel's own functions, then remove it. For hover looks, force the `hot` flag for
  one restart, screenshot with `grim -o <focused monitor>`, then revert. Have the user do the
  real hover and click.
- **Refs:** `CLAUDE.md` "Verifying UI", changelog 2026-10-08
- **Scope:** stack
- **Versions:** none

## 2026-10-08 — QML `Array.prototype.sort` is not stable
- **Context:** Moving the "recommended" section last with a boolean comparator reordered the
  other packages (Inertia jumped ahead of Laravel AI).
- **Lesson:** Never sort to reorder by a boolean in QML JS. Partition instead:
  `out.filter(s => !s.pick).concat(out.filter(s => s.pick))`.
- **Why it matters:** Node's sort *is* stable, so `node --test` passes while the shell shows a
  different order.
- **How to apply:** Partition with filter and concat. Sort only by keys that are total and
  unique.
- **Refs:** `Model.sectionsFor`, changelog 2026-10-08
- **Scope:** stack
- **Versions:** none

## 2026-10-08 — With one widget per monitor, IPC binds to the first-registered instance
- **Context:** `ipc call m0u.artisan open` opened the panel on the other monitor.
- **Lesson:** Every monitor gets its own widget instance, each with an `IpcHandler` for the same
  target. Only the first registered one is used, and the shell logs the rest as "will not be
  used". That instance is often not the one on the focused screen.
- **Why it matters:** Panel actions over IPC (and toast clicks routed through IPC) land on the
  wrong screen.
- **How to apply:** Route panel IPC through `runOnFocused` across `bar.moduleWidgets(name)`,
  or find the opened peer. Keep fetching and notifying on the leader (`[0]`) only.
- **Refs:** `BarWidget.qml`, changelog 2026-10-08
- **Scope:** stack
- **Versions:** none

## 2026-10-08 — Hover must not steal the keyboard cursor when the list scrolls
- **Context:** Arrowing down scrolled the list under a resting pointer, and `onEntered` on the
  row beneath handed it the cursor, which then jumped back.
- **Lesson:** Gate hover on real pointer motion. Use `PointerMoveGate` (qs.Ui) and
  `onPositionChanged`, never `onEntered`, and reset the gate on every keyboard move.
- **Why it matters:** Keyboard navigation fights the mouse and feels broken.
- **How to apply:** `pointerGate.moved(mouseArea, mouse)` in `onPositionChanged`, and
  `pointerGate.reset()` in `moveCursor`, `setFilter` and `resetView`.
- **Refs:** `ItemRow.qml`, `Panel.qml`
- **Scope:** stack
- **Versions:** none

## 2026-10-08 — Scroll a growing row into view twice
- **Context:** Expanding an item's note at the bottom left the note below the fold.
- **Lesson:** A row that just grew reports its new height before the parent Column has
  re-laid out, so `contentHeight` (and the furthest the list may scroll) is still the old value.
- **Why it matters:** The reveal clamps to the stale maximum and the new content stays hidden.
- **How to apply:** Fire the reveal from the row's `onHeightChanged`, scroll once immediately,
  and scroll again from a ~32 ms settle `Timer`.
- **Refs:** `Panel.reveal` / `revealNow`, `ItemRow.onHeightChanged`
- **Scope:** stack
- **Versions:** none
