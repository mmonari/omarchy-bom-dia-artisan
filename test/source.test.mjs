// checkDue's cases are written in local time, and editions are dated in São
// Paulo, so pin the zone: the suite must pass on a machine anywhere.
process.env.TZ = "America/Sao_Paulo";

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
  assert.ok(!argv.includes("--fail"), "--fail would hide the HTTP status");
  assert.match(argv[argv.indexOf("--write-out") + 1], /%\{http_code\} %header\{retry-after\}$/);
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

const reply = (body, code, retry = "") => body + S.TRAILER + code + " " + retry;

test("parse reads the HTTP status from curl's trailer", () => {
  assert.deepEqual(S.parse(reply('[{"date":"2026-10-08"}]', 200), 0).doc, [{ date: "2026-10-08" }]);
  const e404 = S.parse(reply('{"statusCode":404,"statusMessage":"Relatório não encontrado"}', 404), 0);
  assert.equal(e404.ok, false);
  assert.equal(e404.error, "O site respondeu com erro (HTTP 404)");
  assert.equal(e404.retryAfterMs, undefined);
  assert.equal(S.parse(reply("", 0), 0).ok, false, "no status at all");
});

test("a 429 honours Retry-After, in seconds or as a date", () => {
  const now = Date.UTC(2026, 9, 8, 12, 0, 0);
  const secs = S.parse(reply('{"statusCode":429}', 429, "42"), 0, now);
  assert.equal(secs.ok, false);
  assert.match(secs.error, /pausa/);
  assert.equal(secs.retryAfterMs, 42000);
  const date = S.parse(reply("", 429, "Thu, 08 Oct 2026 12:02:00 GMT"), 0, now);
  assert.equal(date.retryAfterMs, 120000);
  assert.equal(S.parse(reply("", 429), 0, now).retryAfterMs, 60000, "no header: one API window");
});

// 2026-10-08, local time.
const at = (h, m = 0) => new Date(2026, 9, 8, h, m).getTime();
const due = (o) => S.checkDue(Object.assign({ checkAt: "09:30", newestDate: "2026-10-07", lastAttemptMs: 0, failures: 0 }, o));

test("checks once a day, at checkAt, and not before", () => {
  assert.equal(due({ nowMs: at(8, 0) }), false, "too early");
  assert.equal(due({ nowMs: at(9, 30) }), true, "the morning check");
  assert.equal(due({ nowMs: at(15, 0) }), true, "machine was off at 09:30: check on wake");
  assert.equal(due({ nowMs: at(15, 0), newestDate: "2026-10-08" }), false, "today's edition already cached");
  assert.equal(due({ nowMs: at(9, 31), lastAttemptMs: at(9, 30), newestDate: "2026-10-08" }), false, "done for the day");
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

test("a 429 holds every check until the site's Retry-After", () => {
  assert.equal(due({ nowMs: at(9, 30), notBeforeMs: at(9, 31) }), false);
  assert.equal(due({ nowMs: at(9, 31), notBeforeMs: at(9, 31) }), true);
});

test("editions are dated in São Paulo, wherever the reader is", () => {
  // 09:30 in Tokyo is 21:30 the evening before in São Paulo.
  assert.equal(S.editionDate(Date.UTC(2026, 9, 8, 0, 30)), "2026-10-07");
  // 09:30 in Lisbon (UTC+1) is 05:30 in São Paulo, same day.
  assert.equal(S.editionDate(Date.UTC(2026, 9, 8, 8, 30)), "2026-10-08");
  // Midnight in São Paulo is 03:00 UTC.
  assert.equal(S.editionDate(Date.UTC(2026, 9, 8, 2, 59)), "2026-10-07");
  assert.equal(S.editionDate(Date.UTC(2026, 9, 8, 3, 0)), "2026-10-08");
  // A Tokyo morning with São Paulo's latest edition already cached: nothing to do.
  const tokyoMorning = Date.UTC(2026, 9, 8, 0, 30);
  assert.equal(S.checkDue({ nowMs: tokyoMorning, checkAt: "00:00", newestDate: "2026-10-07", lastAttemptMs: 0, failures: 0 }), false);
});

// --- the late-day probe ---

const plan = (o) => S.planCheck(Object.assign({ checkAt: "09:30", lastListOkMs: 0, failures: 0, force: false }, o));

test("the day's first check is the list; a late day's retries only probe", () => {
  assert.deepEqual(plan({ nowMs: at(9, 30) }), { kind: "list" }, "nothing fetched yet");
  const yesterday = new Date(2026, 9, 7, 9, 31).getTime();
  assert.deepEqual(plan({ nowMs: at(9, 30), lastListOkMs: yesterday }), { kind: "list" }, "yesterday's list is not today's");
  assert.deepEqual(plan({ nowMs: at(15, 0), lastListOkMs: at(8, 0) }), { kind: "list" }, "a list before checkAt is not the day's check");
  assert.deepEqual(plan({ nowMs: at(10, 30), lastListOkMs: at(9, 30) }), { kind: "probe", date: "2026-10-08" });
});

test("after a failure, or on a click, it is the list again", () => {
  assert.deepEqual(plan({ nowMs: at(10, 30), lastListOkMs: at(9, 30), failures: 1 }), { kind: "list" });
  assert.deepEqual(plan({ nowMs: at(10, 30), lastListOkMs: at(9, 30), force: true }), { kind: "list" });
});

test("the probe asks for São Paulo's date, not the local one", () => {
  // 23:30 in Lisbon (UTC+1) is 19:30 the same day in São Paulo...
  const lisbonEvening = Date.UTC(2026, 9, 8, 22, 30);
  const p = S.planCheck({ nowMs: lisbonEvening, checkAt: "00:00", lastListOkMs: lisbonEvening - 60000, failures: 0 });
  assert.equal(p.date, "2026-10-08");
});

test("request builds the probe URL for a date, and refuses anything else", () => {
  const argv = S.request("probe", "2026-10-08");
  assert.equal(argv[0], "curl");
  assert.equal(argv[argv.length - 1], "https://bom-dia-artisan.dev/api/reports/2026-10-08");
  assert.deepEqual(argv.slice(0, -1), S.request("list").slice(0, -1), "same flags as the list");
  for (const bad of ["2026-10-8", "../../etc", "2026-10-08/../x", "2026-10-08\n", "", undefined, 20261008])
    assert.deepEqual(S.request("probe", bad), [], String(bad));
  assert.equal(S.request("list", "../x").at(-1), "https://bom-dia-artisan.dev/api/reports", "a list ignores the date");
});

const probe = { kind: "probe", date: "2026-10-08" };
const edition = JSON.stringify({ date: "2026-10-08", title: "Edição de 8 de outubro de 2026", sections: [] });

test("a probe's 404 means not out yet, which is not a failure", () => {
  const res = S.parse(reply('{"statusCode":404,"statusMessage":"Relatório não encontrado"}', 404), 0, 0, probe);
  assert.deepEqual(res, { ok: true, pending: true });
});

test("a probe's 200 for that date means it arrived", () => {
  assert.deepEqual(S.parse(reply(edition, 200), 0, 0, probe), { ok: true, arrived: true });
});

test("a probe's 200 that is not that edition is a failure", () => {
  const other = S.parse(reply(edition, 200), 0, 0, { kind: "probe", date: "2026-10-09" });
  assert.equal(other.ok, false);
  assert.equal(other.error, "O site respondeu outra edição");
  assert.equal(S.parse(reply("[" + edition + "]", 200), 0, 0, probe).ok, false, "a list is not an edition");
  assert.equal(S.parse(reply("null", 200), 0, 0, probe).ok, false);
  assert.equal(S.parse(reply("<html>", 200), 0, 0, probe).error, "O site não respondeu JSON");
});

test("a probe's 429 and network errors are failures, as for the list", () => {
  const now = Date.UTC(2026, 9, 8, 12, 0, 0);
  const limited = S.parse(reply('{"statusCode":429}', 429, "42"), 0, now, probe);
  assert.equal(limited.ok, false);
  assert.equal(limited.retryAfterMs, 42000);
  assert.equal(S.parse("", 6, now, probe).offline, true);
  assert.equal(S.parse(reply("", 500), 0, now, probe).ok, false);
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
    assert.ok(!/[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFF}]/u.test(s), `literal glyph in ${f}`);
  }
});
