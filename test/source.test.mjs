import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "./harness.mjs";

const S = load("Source.js");
const A = load("Actions.js");
const T = load("Theme.js");
const ROOT = new URL("..", import.meta.url).pathname;

test("request is a fixed argv against the JSON API, with its own timeout", () => {
  const argv = S.request();
  assert.equal(argv[0], "curl");
  assert.equal(argv[argv.length - 1], "https://bom-dia-artisan.dev/api/reports");
  assert.ok(argv.includes("--fail"));
  const max = Number(argv[argv.indexOf("--max-time") + 1]);
  assert.ok(S.timeoutMs() > max * 1000, "the guard outlives curl's own timeout");
});

test("parse turns curl outcomes into words, never throws", () => {
  assert.deepEqual(S.parse('[{"date":"2026-10-08"}]', 0).doc, [{ date: "2026-10-08" }]);
  assert.equal(S.parse("", 0).ok, false);
  assert.equal(S.parse("<html>", 0).error, "O site não respondeu JSON");
  assert.equal(S.parse("", 6).offline, true);
  assert.equal(S.parse("", 28).error, "O site demorou demais para responder");
  assert.match(S.parse("", 99).error, /curl 99/);
  assert.equal(S.parse(undefined, 0).ok, false);
});

// 2026-10-08, local time.
const at = (h, m = 0) => new Date(2026, 9, 8, h, m).getTime();
const due = (o) => S.checkDue(Object.assign({ checkAt: "09:30", hasToday: false, lastAttemptMs: 0, failures: 0 }, o));

test("checks once a day, at checkAt, and not before", () => {
  assert.equal(due({ nowMs: at(8, 0) }), false, "too early");
  assert.equal(due({ nowMs: at(9, 30) }), true, "the morning check");
  assert.equal(due({ nowMs: at(15, 0) }), true, "machine was off at 09:30: check on wake");
  assert.equal(due({ nowMs: at(15, 0), hasToday: true }), false, "today's edition already cached");
  assert.equal(due({ nowMs: at(9, 31), lastAttemptMs: at(9, 30), hasToday: true }), false, "done for the day");
});

test("yesterday's check does not count for today", () => {
  const yesterday = new Date(2026, 9, 7, 9, 30).getTime();
  assert.equal(due({ nowMs: at(9, 30), lastAttemptMs: yesterday }), true);
});

test("a late edition is retried hourly, a failure with backoff", () => {
  assert.equal(due({ nowMs: at(10, 0), lastAttemptMs: at(9, 30) }), false, "late: wait an hour");
  assert.equal(due({ nowMs: at(10, 30), lastAttemptMs: at(9, 30) }), true, "late: an hour on");
  assert.equal(due({ nowMs: at(9, 31), lastAttemptMs: at(9, 30), failures: 1 }), true, "offline: 1 min");
  assert.equal(due({ nowMs: at(9, 31), lastAttemptMs: at(9, 30), failures: 3 }), false, "offline: 4 min");
  assert.equal(S.failRetryMs(30), 30 * 60000, "capped at 30 min");
});

test("checkAt is parsed leniently and falls back to 09:30", () => {
  assert.equal(S.checkMinutes("7:45"), 7 * 60 + 45);
  assert.equal(S.checkMinutes("09:30"), 570);
  assert.equal(S.checkMinutes("25:00"), 570);
  assert.equal(S.checkMinutes("soon"), 570);
  assert.equal(S.checkMinutes(undefined), 570);
});

test("openUrlArgv only passes http(s) URLs", () => {
  assert.deepEqual(A.openUrlArgv("https://github.com/laravel/ai"), ["xdg-open", "https://github.com/laravel/ai"]);
  assert.deepEqual(A.openUrlArgv("javascript:alert(1)"), []);
  assert.deepEqual(A.openUrlArgv("https://x.dev/a b"), []);
  assert.deepEqual(A.openUrlArgv(undefined), []);
});

test("notifyArgv keeps feed text out of the script", () => {
  const argv = A.notifyArgv('Edição $(rm -rf ~)', "body `id`", "/x/logo.png");
  assert.equal(argv[0], "bash");
  assert.equal(argv[2], A.NOTIFY_SCRIPT);
  assert.ok(!A.NOTIFY_SCRIPT.includes("rm -rf"));
  assert.equal(argv[6], 'Edição $(rm -rf ~)');
  assert.deepEqual(A.notifyArgv("", "b", "i"), []);
});

test("every status has a colour, glyph and label", () => {
  for (const k of ["released", "merged", "recommended", "note"]) {
    assert.match(T.colorFor(k), /^#[0-9A-F]{6}$/i);
    assert.ok(T.glyphFor(k).length > 0);
    assert.ok(T.labelFor(k).length > 0);
  }
  assert.equal(T.colorFor("nope"), T.colorFor("note"));
  for (const name of Object.keys(T.ICONS)) assert.ok(T.icon(name).length > 0, name);
});

// The Write tool and heredocs both unescape \uXXXX into literal private-use
// characters, which render as nothing at all. Source must carry the escape.
test("no literal Nerd Font glyphs in any source file", () => {
  const files = readdirSync(ROOT).filter((f) => /\.(js|qml)$/.test(f));
  for (const f of files) {
    const s = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!/[-]|[\u{F0000}-\u{10FFFF}]/u.test(s), `literal glyph in ${f}`);
  }
});
