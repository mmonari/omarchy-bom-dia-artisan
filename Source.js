.pragma library

// The transport: `curl` against the site's JSON API, spawned by BarWidget.qml.
//
// THE SEAM. This file never spawns anything. It decides what to ask for, how
// long to wait, how soon to ask again, and how to read the answer.
//
// Why the JSON API and not /feed.xml: the RSS feed carries a title and one
// paragraph per edition. `/api/reports` carries the same 16 editions with every
// section, item, status and link — everything the panel is made of — and is
// only ~130 KB. One request fills the whole history.
//
// Two requests, then (see planCheck): the LIST, `/api/reports`, refreshes the
// whole history and is the only answer ever cached; the PROBE,
// `/api/reports/{date}` (~10 KB, 404 until that edition exists), is the cheap
// "is it out yet?" asked on a late day's hourly retries.

var ENDPOINT = "https://bom-dia-artisan.dev/api/reports";
var USER_AGENT = "omarchy-bom-dia-artisan/0.1 (+https://github.com/mmonari/omarchy-bom-dia-artisan)";

// No --fail: it would hide the HTTP status, and a 429 has to be told apart
// from any other error so its Retry-After can be honoured. Instead curl
// appends a trailer line with the status and that header.
var TRAILER = "\n@@bom-dia-artisan ";

// The probe puts a date into a URL, so it takes nothing but YYYY-MM-DD.
function isEditionDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// kind: "list" (the default) or "probe", which needs `date`. A probe with a
// malformed date gets [] — nothing to run — rather than a URL built from it.
function request(kind, date) {
  var url = ENDPOINT;
  if (kind === "probe") {
    if (!isEditionDate(date)) return [];
    url = ENDPOINT + "/" + date;
  }
  return [
    "curl", "--silent", "--show-error", "--location", "--compressed",
    "--max-time", "20", "--connect-timeout", "8",
    "--user-agent", USER_AGENT,
    "--write-out", TRAILER + "%{http_code} %header{retry-after}",
    url
  ];
}

// curl's own --max-time is 20s; this guard is the backstop for a curl that
// never starts or never exits. Every Process gets one.
function timeoutMs() {
  return 25000;
}

var CURL_ERRORS = {
  6: "Sem conexão — o endereço não resolveu",
  7: "Sem conexão com o site",
  22: "O site respondeu com erro",
  28: "O site demorou demais para responder",
  35: "Falha na conexão segura com o site",
  127: "curl não está instalado"
};

// The API allows 10 requests per minute per IP and answers 429 with
// Retry-After (seconds, or an HTTP date). Without a usable value, wait a
// minute: the length of the API's window.
var RATE_LIMIT_FALLBACK_MS = 60000;

function retryAfterMs(value, nowMs) {
  var v = String(value || "").trim();
  if (/^\d+$/.test(v))
    return Math.max(1000, Number(v) * 1000);
  var at = Date.parse(v);
  if (isFinite(at))
    return Math.max(1000, at - (nowMs || Date.now()));
  return RATE_LIMIT_FALLBACK_MS;
}

// Never throws: a widget that throws inside the shell process takes the bar
// with it.
//
// `plan` is what was asked for (see planCheck); without one, the list. A probe
// answers in one of three ways that are not failures to fetch:
//   404                       -> { ok: true, pending: true }  not out yet
//   200, edition of that date -> { ok: true, arrived: true }  fetch the list now
// Anything else from a probe (a 200 that is some other edition, or not JSON)
// is a failure like any other, and so is a 429.
function parse(stdout, exitCode, nowMs, plan) {
  var probe = !!plan && plan.kind === "probe";
  if (exitCode !== 0) {
    var msg = CURL_ERRORS[exitCode] || ("Falha ao buscar as edições (curl " + exitCode + ")");
    return { ok: false, error: msg, offline: exitCode === 6 || exitCode === 7 || exitCode === 28 };
  }
  var out = typeof stdout === "string" ? stdout : "";
  var cut = out.lastIndexOf(TRAILER);
  var status = 200;
  if (cut >= 0) {
    // "<status> <retry-after>", where Retry-After may be an HTTP date with spaces.
    var meta = /^\s*(\d*)\s*(.*)$/.exec(out.slice(cut + TRAILER.length));
    status = Number(meta[1]) || 0;
    out = out.slice(0, cut);
    if (status === 429)
      return { ok: false, error: "O site pediu uma pausa (limite de requisições)", retryAfterMs: retryAfterMs(meta[2], nowMs) };
    if (probe && status === 404)
      return { ok: true, pending: true };
    if (status < 200 || status >= 300)
      return { ok: false, error: "O site respondeu com erro (HTTP " + (status || "?") + ")" };
  }
  var text = out.trim();
  if (!text)
    return { ok: false, error: "O site respondeu vazio" };
  var doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "O site não respondeu JSON" };
  }
  if (!probe)
    return { ok: true, doc: doc, text: text };
  if (doc && typeof doc === "object" && !Array.isArray(doc) && doc.date === plan.date)
    return { ok: true, arrived: true };
  return { ok: false, error: "O site respondeu outra edição" };
}

// When to ask. ONCE A DAY: this is a morning brief, not a ticker.
//
// The edition lands between ~07:00 and ~09:30 in São Paulo (16 days sampled on
// 2026-10-08: 06:56 to 10:30, 15 of 16 out by 09:30). So one check at
// `checkAt` (default 09:30) finds it on almost every day. On the odd late day
// it asks again hourly until the edition is in, then goes quiet until the next
// morning. A failed request (offline, timeout) retries from one minute, doubling
// to 30 minutes, so a machine that wakes up offline still catches up.
//
// A pure "is a check due now?" instead of a long Timer: QML timers run on a
// monotonic clock that stops during suspend, so a timer set last night for
// 09:30 would fire hours late on a machine that slept. The widget asks this
// once a minute, which survives suspend, reboots and clock changes alike.

var DEFAULT_CHECK_AT = "09:30";
var LATE_RETRY_MS = 60 * 60000;
var FAIL_RETRY_CAP_MS = 30 * 60000;

// "9:30" / "09:30" -> minutes after midnight; anything else -> the default.
function checkMinutes(checkAt) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(checkAt || "").trim());
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60)
    return Number(m[1]) * 60 + Number(m[2]);
  return checkMinutes(DEFAULT_CHECK_AT);
}

// Today's check time, as epoch ms, in local time.
function checkTimeMs(nowMs, checkAt) {
  var d = new Date(nowMs);
  var mins = checkMinutes(checkAt);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60).getTime();
}

function failRetryMs(failures) {
  return Math.min(FAIL_RETRY_CAP_MS, 60000 * Math.pow(2, Math.max(0, failures - 1)));
}

// Editions are dated in São Paulo time (metadata.timezone is
// America/Sao_Paulo), so "today's edition" means today *there*, not here. A
// reader in Tokyo whose morning is São Paulo's evening already has that day's
// edition, and must not retry hourly for one that is not due until tomorrow.
// A fixed offset is enough: Brazil has had no daylight saving since 2019, and
// QML's JS has no time zone database to ask.
var EDITION_UTC_OFFSET_MIN = -180;

function editionDate(nowMs) {
  var d = new Date(nowMs + EDITION_UTC_OFFSET_MIN * 60000);
  function two(n) { return n < 10 ? "0" + n : String(n); }
  return d.getUTCFullYear() + "-" + two(d.getUTCMonth() + 1) + "-" + two(d.getUTCDate());
}

// state: { nowMs, checkAt, newestDate, lastAttemptMs, failures, notBeforeMs }
function checkDue(state) {
  if (state.newestDate && state.newestDate >= editionDate(state.nowMs))
    return false;                       // today's edition is in: done for the day
  if (state.nowMs < (Number(state.notBeforeMs) || 0))
    return false;                       // the site asked us to wait (429)
  var due = checkTimeMs(state.nowMs, state.checkAt);
  if (state.nowMs < due)
    return false;                       // too early: wait for the morning check
  var last = Number(state.lastAttemptMs) || 0;
  if (last < due)
    return true;                        // the day's check has not run yet
  var wait = state.failures > 0 ? failRetryMs(state.failures) : LATE_RETRY_MS;
  return state.nowMs - last >= wait;    // failed, or the edition was late
}

// What to ask, once checkDue says to ask. The day's first check is the LIST:
// it refreshes the history and usually finds the edition. Once a list has come
// back today and the edition was still missing, the hourly retries only PROBE
// for it (~10 KB instead of ~130 KB); when the probe finds it, the widget
// fetches the list straight away, so the cache stays one coherent answer.
// After a failure we know nothing, so the retry is the list again, and so is
// a click on refresh.
//
// state: { nowMs, checkAt, lastListOkMs, failures, force }
// lastListOkMs is when a list last came back whole (the cache's fetchedAt).
function planCheck(state) {
  var list = { kind: "list" };
  if (state.force || state.failures > 0)
    return list;
  if ((Number(state.lastListOkMs) || 0) < checkTimeMs(state.nowMs, state.checkAt))
    return list;                        // no list yet today: this is the day's check
  var date = editionDate(state.nowMs);
  return isEditionDate(date) ? { kind: "probe", date: date } : list;
}
