import { test } from "node:test";
import assert from "node:assert/strict";
import { load, fixture } from "./harness.mjs";

const M = load("Model.js");
const real = fixture("reports");
// 2026-10-08 12:00 local — the fixture was captured that morning.
const NOW = new Date(2026, 9, 8, 12, 0, 0).getTime();

const { editions } = M.normalize(real);

test("normalize reads the real API: 16 editions, newest first", () => {
  assert.equal(editions.length, 16);
  assert.equal(editions[0].date, "2026-10-08");
  assert.equal(editions[15].date, "2026-09-23");
  assert.equal(editions[0].url, "https://bom-dia-artisan.dev/reports/2026-10-08");
});

test("counts match the items, and every item gets a status", () => {
  const e = editions[0];
  assert.equal(e.counts.total, 13);
  const sum = e.counts.released + e.counts.merged + e.counts.recommended + e.counts.note;
  assert.equal(sum, e.counts.total);
  const total = editions.reduce((n, ed) => n + ed.counts.total, 0);
  assert.equal(total, 145);
});

test("older editions without a status field get it from the description", () => {
  const old = editions.find((e) => e.date === "2026-09-23");
  const statuses = old.sections.flatMap((s) => s.items.map((i) => i.status));
  assert.ok(statuses.includes("merged"));
  assert.ok(statuses.includes("released"));
  assert.equal(M.inferStatus(undefined, "Released em 23/09/2026. O vet.json"), "released");
  assert.equal(M.inferStatus(null, "Merged em 13.x."), "merged");
  assert.equal(M.inferStatus("", "Um pacote novo"), "note");
  assert.equal(M.inferStatus("Recommended", ""), "recommended");
});

test("normalize refuses junk without throwing", () => {
  assert.equal(M.normalize(null).ok, false);
  assert.equal(M.normalize("x").ok, false);
  assert.equal(M.normalize([]).ok, false);
  assert.equal(M.normalize([{ date: "yesterday" }]).ok, false);
  const one = M.normalize({ date: "2026-10-08", sections: [{ name: "X", items: [{ title: "t", url: "javascript:alert(1)" }] }] });
  assert.equal(one.ok, true);
  assert.equal(one.editions[0].sections[0].items[0].url, "");
});

test("duplicate dates collapse to one edition", () => {
  const r = M.normalize([real[0], real[0], real[1]]);
  assert.deepEqual(r.editions.map((e) => e.date), ["2026-10-08", "2026-10-07"]);
});

test("the recommendation of the day always closes the edition", () => {
  const secs = M.sectionsFor(editions[0], "all");
  assert.equal(secs[secs.length - 1].pick, true);
  assert.equal(secs[secs.length - 1].name, "Recomendação do dia");
  assert.ok(secs.slice(0, -1).every((s) => !s.pick));
});

test("packages keep the editors' order", () => {
  const names = M.sectionsFor(editions[0], "all").map((s) => s.name);
  const api = real[0].sections.map((s) => s.name).filter((n) => n !== "Recomendação do dia");
  assert.deepEqual(names.slice(0, -1), api);
});

test("filters keep only matching items and drop empty sections", () => {
  const rel = M.sectionsFor(editions[0], "released");
  assert.ok(rel.length > 0);
  assert.ok(rel.every((s) => s.items.every((i) => i.status === "released")));
  const n = rel.reduce((k, s) => k + s.items.length, 0);
  assert.equal(n, editions[0].counts.released);
});

test("a filter the day cannot satisfy falls back to everything", () => {
  const noRelease = editions.find((e) => e.counts.released === 0);
  assert.ok(noRelease, "fixture has a day without releases");
  assert.equal(M.effectiveFilter(noRelease, "released"), "all");
  assert.equal(M.sectionsFor(noRelease, "released").length, M.sectionsFor(noRelease, "all").length);
});

test("filter chips only offer what the edition has", () => {
  const opts = M.filterOptions(editions[0]);
  assert.equal(opts[0].key, "all");
  assert.equal(opts[0].count, 13);
  assert.ok(opts.every((o) => o.count > 0));
  assert.equal(M.cycleFilter(editions[0], "all", 1), opts[1].key);
  assert.equal(M.cycleFilter(editions[0], "all", -1), opts[opts.length - 1].key);
});

test("cursor walks the flattened rows and stops at the ends", () => {
  const keys = M.navKeys(M.sectionsFor(editions[0], "all"));
  assert.equal(keys.length, 13);
  assert.equal(M.moveCursor(keys, "", 1), keys[0]);
  assert.equal(M.moveCursor(keys, "", -1), keys[12]);
  assert.equal(M.moveCursor(keys, keys[0], -1), keys[0]);
  assert.equal(M.moveCursor(keys, keys[12], 1), keys[12]);
  assert.equal(M.moveCursor(keys, keys[3], 1), keys[4]);
  assert.equal(M.moveCursor([], "x", 1), "");
});

test("first run greets with one unread edition, not sixteen", () => {
  const read = M.seedRead(editions);
  assert.deepEqual(M.unreadDates(editions, read), ["2026-10-08"]);
});

test("markRead is idempotent, ignores junk and is capped", () => {
  let r = M.markRead([], "2026-10-08");
  r = M.markRead(r, "2026-10-08");
  r = M.markRead(r, "not-a-date");
  assert.deepEqual(r, ["2026-10-08"]);
  let many = [];
  for (let d = 1; d <= 28; d++)
    for (const m of ["01", "02", "03", "04", "05"])
      many = M.markRead(many, `2026-${m}-${String(d).padStart(2, "0")}`);
  assert.equal(many.length, M.READ_CAP);
  assert.equal(many[0], "2026-05-28", "keeps the newest marks");
  assert.deepEqual(M.unreadDates(editions, M.markAllRead([], editions)), []);
});

test("a toast fires once, only for a fresh unread newest edition", () => {
  const seeded = M.seedRead(editions);
  assert.equal(M.notifyCandidate(editions, seeded, "", NOW).date, "2026-10-08");
  assert.equal(M.notifyCandidate(editions, seeded, "2026-10-08", NOW), null, "already notified");
  assert.equal(M.notifyCandidate(editions, M.markRead(seeded, "2026-10-08"), "", NOW), null, "already read");
  const weekLater = NOW + 7 * 86400000;
  assert.equal(M.notifyCandidate(editions, seeded, "", weekLater), null, "too old to announce");
  assert.equal(M.notifyCandidate([], [], "", NOW), null);
});

test("dates read as Brazilian Portuguese, in local time", () => {
  assert.equal(M.shortDate("2026-10-08"), "qui, 8 out");
  assert.equal(M.longDate("2026-10-08"), "quinta-feira, 8 de outubro");
  assert.equal(M.longDate("2026-10-08", false), "8 de outubro de 2026");
  assert.equal(M.dayLabel("2026-10-08", NOW), "Hoje");
  assert.equal(M.dayLabel("2026-10-07", NOW), "Ontem");
  assert.equal(M.dayLabel("2026-10-01", NOW), "qui, 1 out");
  // Month boundary: "yesterday" of Oct 1 is Sep 30.
  assert.equal(M.dayLabel("2026-09-30", new Date(2026, 9, 1, 9).getTime()), "Ontem");
});

test("relative times", () => {
  assert.equal(M.relative(NOW - 20000, NOW), "agora");
  assert.equal(M.relative(NOW - 5 * 60000, NOW), "há 5 min");
  assert.equal(M.relative(NOW - 3 * 3600000, NOW), "há 3 h");
  assert.equal(M.relative(NOW - 26 * 3600000, NOW), "ontem");
  assert.equal(M.relative(NOW - 4 * 86400000, NOW), "há 4 dias");
  assert.equal(M.relative(0, NOW), "");
});

test("richText escapes markup and styles code spans", () => {
  const out = M.richText("Use `composer require <x>` & <b>not</b> this", "#abc");
  assert.equal(out,
    'Use <font face="monospace" color="#abc">composer require &lt;x&gt;</font> &amp; &lt;b&gt;not&lt;/b&gt; this');
  assert.equal(M.plainText("a `b` c"), "a b c");
});

test("truncate cuts on a word and says so", () => {
  const s = "Laravel AI 1.2.0 trouxe OpenAI Decisions, correções de structured output e novos defaults";
  const t = M.truncate(s, 40);
  assert.ok(t.length <= 40);
  assert.ok(t.endsWith("…"));
  assert.ok(!/\s…$/.test(t));
  assert.equal(M.truncate("curto", 40), "curto");
});

test("summary levels and tooltip", () => {
  assert.equal(M.summarize({ editions: [], read: [] }).level, "loading");
  assert.equal(M.summarize({ editions: [], read: [], error: "Sem conexão com o site" }).level, "offline");
  const unread = M.summarize({ editions, read: M.seedRead(editions) });
  assert.equal(unread.level, "unread");
  assert.deepEqual(unread.unread, ["2026-10-08"]);
  const tip = M.tooltip(unread, NOW);
  assert.match(tip, /hoje/);
  assert.match(tip, /13 novidades · 2 releases/);
  assert.match(tip, /Edição nova/);
  const stale = M.summarize({ editions, read: M.markAllRead([], editions), error: "Sem conexão com o site" });
  assert.equal(stale.level, "read");
  assert.equal(stale.stale, true);
  assert.match(M.tooltip(stale, NOW), /Offline/);
});
