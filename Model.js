.pragma library

// Everything this plugin decides, as pure functions. No QML, no I/O.
//
// BarWidget.qml fetches, Panel.qml draws, and every rule in between lives here,
// so that `node --test` runs the exact file the shell loads. If a rule is worth
// getting right, it does not live in a .qml file.

var SITE = "https://bom-dia-artisan.dev";

// How many read-marks to keep. The API serves 16 editions; keeping a few months
// of marks means an edition that drops out of the window and comes back (a
// re-publish, a timezone slip) is still remembered as read.
var READ_CAP = 120;

// A new edition older than this never raises a notification. It covers the
// first fetch after a week away: the bar dot already says "unread", and a
// desktop toast for last Tuesday's news is noise.
var NOTIFY_MAX_AGE_MS = 36 * 3600 * 1000;

var WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
var WEEKDAY_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado"];
var MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set",
  "out", "nov", "dez"];
var MONTH_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Order of the filter chips, and the plural each one is called by.
var FILTERS = [
  { key: "all", label: "Tudo" },
  { key: "released", label: "Releases" },
  { key: "merged", label: "Merged" },
  { key: "recommended", label: "Dicas" }
];

// ------------------------------------------------------------- utilities --

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

// Only http(s), and nothing a shell or a URL handler could read twice. Every
// URL in this plugin ends up as an argv element to xdg-open; the check is about
// refusing junk, not about quoting, which execArgv already makes unnecessary.
function safeUrl(u) {
  var s = str(u);
  return /^https?:\/\/[^\s"'<>]+$/.test(s) ? s : "";
}

function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// "2026-10-08" as a LOCAL date. `new Date("2026-10-08")` would be UTC
// midnight, which is the previous evening in Brazil, and every weekday label
// would be off by one.
function parseIso(iso) {
  var p = iso.split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function isoOf(d) {
  function two(n) { return n < 10 ? "0" + n : String(n); }
  return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
}

function todayIso(nowMs) {
  return isoOf(new Date(nowMs));
}

// ------------------------------------------------------------ normalizing --

// Older editions (before ~2026-09-24) have no `status` field and say it in the
// first word of the description instead: "Merged em 13.x. …", "Released em
// 23/09/2026. …". Reading that keeps the chips honest across the whole window.
function inferStatus(raw, description) {
  var s = str(raw).toLowerCase();
  if (s === "released" || s === "merged" || s === "recommended")
    return s;
  var d = str(description);
  if (/^released\b/i.test(d)) return "released";
  if (/^merged\b/i.test(d)) return "merged";
  return "note";
}

function normalizeItem(raw, key) {
  if (!raw || typeof raw !== "object")
    return null;
  var title = str(raw.title);
  if (!title)
    return null;
  var description = str(raw.description);
  return {
    key: key,
    title: title,
    description: description,
    details: str(raw.details),
    source: str(raw.source),
    url: safeUrl(raw.url),
    status: inferStatus(raw.status, description)
  };
}

function emptyCounts() {
  return { total: 0, released: 0, merged: 0, recommended: 0, note: 0 };
}

function normalizeEdition(raw) {
  if (!raw || typeof raw !== "object" || !isIsoDate(raw.date))
    return null;

  var counts = emptyCounts();
  var sections = [];
  var rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  for (var s = 0; s < rawSections.length; s++) {
    var rs = rawSections[s];
    if (!rs || typeof rs !== "object")
      continue;
    var items = [];
    var rawItems = Array.isArray(rs.items) ? rs.items : [];
    for (var i = 0; i < rawItems.length; i++) {
      var item = normalizeItem(rawItems[i], raw.date + ":" + s + ":" + i);
      if (!item)
        continue;
      items.push(item);
      counts.total += 1;
      counts[item.status] += 1;
    }
    if (items.length)
      sections.push({ name: str(rs.name) || "Outros", items: items });
  }

  var meta = raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  var generated = Date.parse(str(raw.generatedAt));

  return {
    date: raw.date,
    title: str(raw.title) || ("Edição de " + longDate(raw.date, false)),
    summary: str(raw.summary),
    attention: str(meta.attention),
    generatedMs: isFinite(generated) ? generated : parseIso(raw.date).getTime(),
    url: SITE + "/reports/" + raw.date,
    sections: sections,
    counts: counts
  };
}

// The API answers `/api/reports` with an array. A single report object (what
// `/api/reports/<date>` answers) is accepted too, so a future switch of
// endpoint is a one-line change in Source.js.
function normalize(doc) {
  var list = Array.isArray(doc) ? doc : (doc && typeof doc === "object" ? [doc] : null);
  if (!list)
    return { ok: false, error: "A resposta não é uma lista de edições" };

  var seen = {};
  var editions = [];
  for (var i = 0; i < list.length; i++) {
    var e = normalizeEdition(list[i]);
    if (e && !seen[e.date]) {
      seen[e.date] = true;
      editions.push(e);
    }
  }
  if (!editions.length)
    return { ok: false, error: "Nenhuma edição reconhecível na resposta" };

  editions.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return { ok: true, editions: editions };
}

// --------------------------------------------------------------- filtering --

// Chips worth showing for this edition: "Tudo" always, the rest only when they
// would match something. A chip that filters to an empty panel is a dead end.
function filterOptions(edition) {
  var c = edition ? edition.counts : emptyCounts();
  var out = [];
  for (var i = 0; i < FILTERS.length; i++) {
    var f = FILTERS[i];
    var n = f.key === "all" ? c.total : c[f.key];
    if (f.key === "all" || n > 0)
      out.push({ key: f.key, label: f.label, count: n });
  }
  return out;
}

// A filter that the current edition cannot satisfy falls back to "all" rather
// than showing nothing — flipping to a day with no releases while "Releases" is
// selected should show that day, not an empty card.
function effectiveFilter(edition, filter) {
  if (filter === "all" || !edition)
    return "all";
  return edition.counts[filter] > 0 ? filter : "all";
}

function sectionsFor(edition, filter) {
  if (!edition)
    return [];
  var f = effectiveFilter(edition, filter);
  var out = [];
  for (var s = 0; s < edition.sections.length; s++) {
    var sec = edition.sections[s];
    var items = f === "all" ? sec.items : sec.items.filter(function (it) { return it.status === f; });
    if (!items.length)
      continue;
    var pick = items.every(function (it) { return it.status === "recommended"; });
    out.push({ name: sec.name, items: items, pick: pick });
  }
  // The recommendation of the day closes the edition, wherever the API put it:
  // news first, then the thing to read with your coffee. A partition, not a
  // sort: QML's Array.prototype.sort is not stable, and sorting on a boolean
  // reshuffled the packages (Inertia jumped ahead of Laravel AI on screen).
  return out.filter(function (s) { return !s.pick; })
    .concat(out.filter(function (s) { return s.pick; }));
}

function cycleFilter(edition, filter, step) {
  var opts = filterOptions(edition);
  var cur = effectiveFilter(edition, filter);
  var idx = 0;
  for (var i = 0; i < opts.length; i++)
    if (opts[i].key === cur) idx = i;
  var next = (idx + (step || 1) + opts.length) % opts.length;
  return opts[next].key;
}

// ------------------------------------------------------------------ cursor --

function navKeys(sections) {
  var keys = [];
  for (var s = 0; s < sections.length; s++)
    for (var i = 0; i < sections[s].items.length; i++)
      keys.push(sections[s].items[i].key);
  return keys;
}

// No cursor + Down lands on the first row; no cursor + Up on the last. Moving
// past either end stops there rather than wrapping: wrapping in a long list
// reads as the panel jumping.
function moveCursor(keys, current, dy) {
  if (!keys.length)
    return "";
  var idx = keys.indexOf(current);
  if (idx < 0)
    return dy < 0 ? keys[keys.length - 1] : keys[0];
  return keys[Math.max(0, Math.min(keys.length - 1, idx + dy))];
}

function findItem(sections, key) {
  for (var s = 0; s < sections.length; s++)
    for (var i = 0; i < sections[s].items.length; i++)
      if (sections[s].items[i].key === key) return sections[s].items[i];
  return null;
}

// ---------------------------------------------------------------- reading --

function cleanRead(read) {
  return Array.isArray(read) ? read.filter(isIsoDate) : [];
}

function unreadDates(editions, read) {
  var r = cleanRead(read);
  var out = [];
  for (var i = 0; i < (editions || []).length; i++)
    if (r.indexOf(editions[i].date) < 0) out.push(editions[i].date);
  return out;
}

// First run: everything but the newest edition counts as read. Sixteen unread
// editions on install is a backlog nobody asked for; one is a greeting.
function seedRead(editions) {
  var out = [];
  for (var i = 1; i < (editions || []).length; i++)
    out.push(editions[i].date);
  return out;
}

function markRead(read, date) {
  var r = cleanRead(read);
  if (!isIsoDate(date) || r.indexOf(date) >= 0)
    return r;
  r = r.concat([date]);
  r.sort().reverse();
  return r.slice(0, READ_CAP);
}

function markAllRead(read, editions) {
  var r = cleanRead(read);
  for (var i = 0; i < (editions || []).length; i++)
    r = markRead(r, editions[i].date);
  return r;
}

// The edition a toast should announce, or null. Only the newest, only once
// (`notified` remembers it), only if unread, and only if fresh.
function notifyCandidate(editions, read, notified, nowMs) {
  if (!editions || !editions.length)
    return null;
  var e = editions[0];
  if (e.date === notified || cleanRead(read).indexOf(e.date) >= 0)
    return null;
  if (nowMs - e.generatedMs > NOTIFY_MAX_AGE_MS)
    return null;
  return e;
}

// ------------------------------------------------------------------ words --

function shortDate(iso) {
  if (!isIsoDate(iso)) return "";
  var d = parseIso(iso);
  return WEEKDAY_SHORT[d.getDay()] + ", " + d.getDate() + " " + MONTH_SHORT[d.getMonth()];
}

function longDate(iso, withWeekday) {
  if (!isIsoDate(iso)) return "";
  var d = parseIso(iso);
  var core = d.getDate() + " de " + MONTH_LONG[d.getMonth()];
  return withWeekday === false ? core + " de " + d.getFullYear() : WEEKDAY_LONG[d.getDay()] + ", " + core;
}

// "Hoje" and "Ontem" beat a date for the two days anyone actually reads.
function dayLabel(iso, nowMs) {
  var today = todayIso(nowMs);
  if (iso === today) return "Hoje";
  var y = new Date(nowMs);
  y.setDate(y.getDate() - 1);
  if (iso === isoOf(y)) return "Ontem";
  return shortDate(iso);
}

function relative(ms, nowMs) {
  if (!ms || !isFinite(ms)) return "";
  var sec = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (sec < 60) return "agora";
  var min = Math.round(sec / 60);
  if (min < 60) return "há " + min + " min";
  var h = Math.round(min / 60);
  if (h < 24) return "há " + h + " h";
  var d = Math.round(h / 24);
  return d === 1 ? "ontem" : "há " + d + " dias";
}

function headline(edition) {
  if (!edition) return "";
  var c = edition.counts;
  var parts = [plural(c.total, "novidade", "novidades")];
  if (c.released) parts.push(plural(c.released, "release", "releases"));
  return parts.join(" · ");
}

// Escape for Text.StyledText, and turn `code spans` (the editors use them for
// class names, composer commands, config keys) into monospace runs. Anything
// else stays literal: the feed is data, never markup.
function richText(text, codeColor) {
  var s = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return s.replace(/`([^`\n]+)`/g, function (_m, code) {
    return "<font face=\"monospace\" color=\"" + codeColor + "\">" + code + "</font>";
  });
}

// The editors' full notes are Markdown (the API docs say so, and the notes
// use it: paragraphs, `##` headings, lists, ``` blocks, [links](…), bare URLs).
// Qt's StyledText is a small HTML subset that collapses newlines, so without
// this a note reads as one run-on paragraph with the markup printed in it.
//
// Not a general Markdown parser: it covers what the site writes, and anything
// it does not know falls through as escaped text, which still reads fine.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isHref(url) {
  return /^https?:\/\/[^\s"<>]+$/.test(url);
}

function codeSpan(code, codeColor) {
  return "<font face=\"monospace\" color=\"" + codeColor + "\">" + escapeHtml(code) + "</font>";
}

function emphasis(html) {
  return html
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^\w*])\*([^*\s][^*\n]*?)\*(?![\w*])/g, "$1<i>$2</i>");
}

// One line of Markdown. Code spans and links are lifted out first, as
// placeholders, so a `**` inside code or a `_` inside a URL is never styled.
function inlineMarkdown(raw, codeColor) {
  var held = [];
  function hold(html) { held.push(html); return "\u0001" + (held.length - 1) + "\u0001"; }
  var s = String(raw || "");
  s = s.replace(/`([^`\n]+)`/g, function (_m, code) { return hold(codeSpan(code, codeColor)); });
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
    return isHref(url) ? hold("<a href=\"" + url + "\">" + emphasis(escapeHtml(label)) + "</a>") : m;
  });
  s = s.replace(/https?:\/\/[^\s<>"'`\u0001]+/g, function (url) {
    var trail = /[.,;:!?)\]]+$/.exec(url);
    var bare = trail ? url.slice(0, -trail[0].length) : url;
    return isHref(bare) ? hold("<a href=\"" + bare + "\">" + escapeHtml(bare) + "</a>") + (trail ? trail[0] : "") : url;
  });
  s = emphasis(escapeHtml(s));
  // Link labels can hold code spans, so restore until nothing is left.
  for (var guard = 0; guard < 4 && /\u0001\d+\u0001/.test(s); guard++)
    s = s.replace(/\u0001(\d+)\u0001/g, function (_m, n) { return held[Number(n)]; });
  return s;
}

function codeBlock(lines, codeColor) {
  var body = lines.map(function (l) {
    return escapeHtml(l).replace(/^ +/, function (sp) { return sp.replace(/ /g, "&nbsp;"); });
  }).join("<br>");
  return "<font face=\"monospace\" color=\"" + codeColor + "\">" + body + "</font>";
}

function markdown(text, codeColor) {
  var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  var blocks = [];
  var para = [];
  var list = [];

  function push(kind, html) { blocks.push({ kind: kind, html: html }); }
  function flushPara() {
    if (para.length) push("p", inlineMarkdown(para.join(" "), codeColor));
    para = [];
  }
  function flushList() {
    if (list.length)
      push("list", list.map(function (it) {
        return it.mark + "&nbsp;" + inlineMarkdown(it.text, codeColor);
      }).join("<br>"));
    list = [];
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara(); flushList();
      var code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      push("code", codeBlock(code, codeColor));
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    var h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flushPara(); flushList(); push("h", "<b>" + inlineMarkdown(h[1], codeColor) + "</b>"); continue; }
    var li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      list.push({ mark: /\d/.test(li[1]) ? li[1].replace(")", ".") : "•", text: li[2] });
      continue;
    }
    if (list.length && /^\s+\S/.test(line)) { list[list.length - 1].text += " " + line.trim(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();

  // A heading sits right on top of its text; every other block gets a blank
  // line before the next one.
  var out = "";
  for (var b = 0; b < blocks.length; b++) {
    if (b > 0) out += blocks[b - 1].kind === "h" ? "<br>" : "<br><br>";
    out += blocks[b].html;
  }
  return out;
}

// Strip code ticks for places that cannot render them (tooltips, toasts).
function plainText(text) {
  return String(text || "").replace(/`([^`\n]+)`/g, "$1");
}

function truncate(text, max) {
  var s = plainText(text);
  if (s.length <= max) return s;
  var cut = s.lastIndexOf(" ", max - 1);
  return s.slice(0, cut > max * 0.6 ? cut : max - 1).replace(/[\s,.;:]+$/, "") + "…";
}

// ---------------------------------------------------------------- summary --

function empty() {
  return {
    level: "loading",
    editions: [],
    latest: null,
    unread: [],
    stale: false,
    error: "",
    lastOkMs: 0
  };
}

// The one object both views bind to.
//   level: "loading" — nothing fetched yet, nothing cached
//          "offline" — never fetched, and the fetch failed
//          "unread"  — an edition you have not opened
//          "read"    — up to date
function summarize(input) {
  var editions = input.editions || [];
  var unread = unreadDates(editions, input.read);
  var level;
  if (!editions.length)
    level = input.error ? "offline" : "loading";
  else
    level = unread.length ? "unread" : "read";
  return {
    level: level,
    editions: editions,
    latest: editions.length ? editions[0] : null,
    unread: unread,
    stale: !!(input.error && editions.length),
    error: input.error || "",
    lastOkMs: input.lastOkMs || 0
  };
}

function tooltip(summary, nowMs) {
  if (summary.level === "loading")
    return "Bom Dia, Artisan\nBuscando a edição de hoje…";
  if (summary.level === "offline")
    return "Bom Dia, Artisan\n" + summary.error;

  var e = summary.latest;
  var lines = ["Bom Dia, Artisan · " + dayLabel(e.date, nowMs).toLowerCase(),
    headline(e)];
  if (summary.unread.length === 1)
    lines.push("Edição nova — clique para ler");
  else if (summary.unread.length > 1)
    lines.push(summary.unread.length + " edições não lidas");
  if (summary.stale)
    lines.push("Offline — " + summary.error.toLowerCase());
  return lines.join("\n");
}
