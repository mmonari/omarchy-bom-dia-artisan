import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Actions.js" as Actions
import "Model.js" as Model
import "Source.js" as Source

// The only file in this plugin that does I/O: one curl, two small files, and
// whatever it launches (xdg-open, notify-send). Everything it decides comes
// from Model.js / Source.js, which `node --test` runs directly.
//
// ONE BAR PER MONITOR. The shell builds this widget once per output, and two
// copies polling, notifying and writing the read-marks would mean two toasts
// per edition and a race on the state file. So:
//
//   - the LEADER (the first instance the bar lists) is the only one that
//     fetches and the only one that notifies;
//   - every instance renders from the two files on disk, and re-reads them when
//     they change — the cache the leader writes, and the read-marks any
//     instance writes when you read an edition on its screen.
BarWidget {
  id: root
  moduleName: "m0u.artisan"

  // SHAPE CONTRACT: `opened`, `open()`, `close()` and `popoutSwitchClosing` on
  // the widget root. The bar's panel lookup, the IPC toggle, SUPER+CTRL+<n> and
  // Tab all skip a slot missing any of them, silently.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item
    ? panelLoader.item.popoutSwitchClosing === true : false

  readonly property string checkAt: String(root.setting("checkAt", Source.DEFAULT_CHECK_AT))
  readonly property bool notifyEnabled: String(root.setting("notify", "on")) !== "off"

  readonly property string stateDir: Quickshell.env("HOME") + "/.local/state/m0u-artisan"
  readonly property string cacheDir: Quickshell.env("HOME") + "/.cache/m0u-artisan"

  function pathOf(rel) {
    var url = Qt.resolvedUrl(rel).toString();
    return url.indexOf("file://") === 0 ? decodeURIComponent(url.substring(7)) : url;
  }

  property double nowMs: Date.now()
  readonly property var summary: Model.summarize({
    editions: internal.editions,
    read: internal.read,
    error: internal.error,
    lastOkMs: internal.lastOkMs
  })

  QtObject {
    id: internal
    property var editions: []
    property var read: []
    property string notified: ""
    property bool stateKnown: false    // the state file has been tried
    property bool hadState: false      // ...and existed
    property bool dirsReady: false
    property bool cacheKnown: false    // the cache file has been tried
    property double lastAttemptMs: 0
    // Set by a 429: no request, scheduled or clicked, before this time.
    property double notBeforeMs: 0
    property double lastOkMs: 0
    property string error: ""
    property int failures: 0
    property bool inFlight: false
  }

  // ------------------------------------------------------------ leadership --

  function peers() {
    return root.bar && typeof root.bar.moduleWidgets === "function"
      ? root.bar.moduleWidgets(root.moduleName) : [root];
  }

  function isLeader() {
    var list = root.peers();
    return !list || !list.length || list[0] === root;
  }

  function leader() {
    var list = root.peers();
    return list && list.length ? list[0] : root;
  }

  // ----------------------------------------------------------------- panel --

  function open() {
    if (!panelLoader.item) return;
    // Opening never fetches: the day's one check has already happened (or will
    // at checkAt). Followers just pick up whatever the leader last wrote.
    root.syncFromDisk();
    root.nowMs = Date.now();
    panelLoader.item.open();
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close();
  }

  function toggle() {
    if (root.opened) root.close(); else root.open();
  }

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch();
  }

  // Open/close the instance on the focused output: on two monitors, "show me
  // this" means the screen you are looking at, not both.
  function runOnFocused(verb) {
    var host = root.bar;
    if (host && typeof host.summonBarWidget === "function") {
      if (verb === "close" || (verb === "toggle" && host.isBarWidgetOpen(root.moduleName)))
        host.hideBarWidget(root.moduleName);
      else
        host.summonBarWidget(root.moduleName);
      return;
    }
    if (verb === "open") root.open();
    else if (verb === "close") root.close();
    else root.toggle();
  }

  // --------------------------------------------------------------- actions --

  function openUrl(url) {
    var argv = Actions.openUrlArgv(url);
    if (argv.length) Util.execArgv(argv);
  }

  function markRead(date) {
    var next = Model.markRead(internal.read, date);
    if (next.length === internal.read.length) return;
    internal.read = next;
    root.saveState();
  }

  function markAllRead() {
    internal.read = Model.markAllRead(internal.read, internal.editions);
    root.saveState();
  }

  // ------------------------------------------------------------- the files --

  function saveState() {
    if (!internal.dirsReady) return;
    stateFile.setText(JSON.stringify({ read: internal.read, notified: internal.notified }, null, 2) + "\n");
  }

  function markCacheKnown() {
    if (internal.cacheKnown) return;
    internal.cacheKnown = true;
    root.maybeCheck();
  }

  function syncFromDisk() {
    stateFile.reload();
    cacheFile.reload();
  }

  function applyState(text) {
    try {
      var doc = JSON.parse(String(text || ""));
      internal.read = Model.cleanRead(doc.read);
      internal.notified = typeof doc.notified === "string" ? doc.notified : "";
      internal.hadState = true;
    } catch (e) {
      // A corrupt state file is treated as no state: worst case, one edition
      // shows as unread again.
      internal.hadState = false;
    }
    internal.stateKnown = true;
    root.afterData();
  }

  function applyCache(text) {
    try {
      var doc = JSON.parse(String(text || ""));
      var res = Model.normalize(doc.reports);
      if (!res.ok) return;
      internal.editions = res.editions;
      if (doc.fetchedAt > internal.lastOkMs) internal.lastOkMs = doc.fetchedAt;
      root.afterData();
    } catch (e) {
      // Ignore a half-written or foreign cache; the next fetch replaces it.
    }
  }

  // Runs whenever editions or read-marks change. First run seeds the
  // read-marks (one unread edition, not sixteen) without a toast; afterwards,
  // the leader announces a fresh edition exactly once.
  function afterData() {
    if (!internal.stateKnown || !internal.editions.length) return;

    if (!internal.hadState) {
      internal.read = Model.seedRead(internal.editions);
      internal.notified = internal.editions[0].date;
      internal.hadState = true;
      root.saveState();
      return;
    }

    if (!root.isLeader() || !root.notifyEnabled) return;
    var e = Model.notifyCandidate(internal.editions, internal.read, internal.notified, Date.now());
    if (!e) return;
    // Persist BEFORE sending, so a restart or the other monitor's instance can
    // never announce the same edition twice.
    internal.notified = e.date;
    root.saveState();
    var body = Model.headline(e) + "\n" + Model.truncate(e.summary, 220);
    Util.execArgv(Actions.notifyArgv(e.title, body, root.pathOf("assets/logo.png")));
  }

  // ------------------------------------------------------------------ fetch --

  function refresh(force) {
    if (!root.isLeader()) {
      // Followers ask the leader, then show whatever lands on disk.
      var l = root.leader();
      if (l && l !== root && typeof l.refresh === "function") l.refresh(force);
      root.syncFromDisk();
      return;
    }
    if (internal.inFlight || !internal.dirsReady) return;
    // Rate limited: a click would only earn another 429.
    if (Date.now() < internal.notBeforeMs) return;
    internal.inFlight = true;
    internal.lastAttemptMs = Date.now();
    fetchProc.command = Source.request();
    guard.interval = Source.timeoutMs();
    guard.restart();
    fetchProc.running = true;
  }

  function succeed(res) {
    var norm = Model.normalize(res.doc);
    if (!norm.ok) { root.fail(norm.error); return; }
    internal.failures = 0;
    internal.error = "";
    internal.lastOkMs = Date.now();
    internal.editions = norm.editions;
    cacheFile.setText(JSON.stringify({ fetchedAt: internal.lastOkMs, reports: res.doc }));
    root.afterData();
  }

  function fail(reason, retryAfterMs) {
    internal.failures += 1;
    internal.error = reason;
    if (retryAfterMs > 0) internal.notBeforeMs = Date.now() + retryAfterMs;
  }

  // Asked once a minute (and at startup): is the day's check due? Leader only,
  // and only after the cache has been read — otherwise every shell restart
  // would fetch before finding out that today's edition is already on disk.
  function maybeCheck() {
    if (!root.isLeader() || !internal.dirsReady || !internal.cacheKnown) return;
    var now = Date.now();
    if (Source.checkDue({
      nowMs: now,
      checkAt: root.checkAt,
      newestDate: internal.editions.length > 0 ? internal.editions[0].date : "",
      lastAttemptMs: internal.lastAttemptMs,
      failures: internal.failures,
      notBeforeMs: internal.notBeforeMs
    }))
      root.refresh(false);
  }

  Process {
    id: mkdirProc
    command: ["mkdir", "-p", root.stateDir, root.cacheDir]
    onExited: {
      internal.dirsReady = true;
      root.maybeCheck();
    }
  }

  Process {
    id: fetchProc
    command: ["true"]
    stdout: StdioCollector { waitForEnd: true }

    onExited: function (exitCode) {
      guard.stop();
      internal.inFlight = false;
      var res = Source.parse(stdout.text, exitCode, Date.now());
      if (res.ok) root.succeed(res); else root.fail(res.error, res.retryAfterMs || 0);
    }
  }

  // Every Process gets a hard guard, on top of curl's own --max-time.
  Timer {
    id: guard
    repeat: false
    onTriggered: {
      if (fetchProc.running) fetchProc.running = false;
      internal.inFlight = false;
      root.fail("O site demorou demais para responder");
    }
  }

  // The one clock: relative times ("há 5 min") and "is the day's check due"
  // both move with it. Wall-clock based, so it is right again one minute after
  // a resume from suspend — see the header of Source.checkDue.
  Timer {
    interval: 60000
    repeat: true
    running: true
    onTriggered: {
      root.nowMs = Date.now();
      root.maybeCheck();
    }
  }

  FileView {
    id: stateFile
    path: root.stateDir + "/state.json"
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.applyState(text())
    onLoadFailed: {
      internal.stateKnown = true;
      root.afterData();
    }
  }

  FileView {
    id: cacheFile
    path: root.cacheDir + "/reports.json"
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      root.applyCache(text());
      root.markCacheKnown();
    }
    onLoadFailed: root.markCacheKnown()
  }

  Component.onCompleted: mkdirProc.running = true

  IpcHandler {
    target: "m0u.artisan"

    function refresh(): void { root.refresh(true); }
    function open(): void { root.runOnFocused("open"); }
    function close(): void { root.runOnFocused("close"); }
    function toggle(): void { root.runOnFocused("toggle"); }
    function markAllRead(): void { root.markAllRead(); }
  }

  // ------------------------------------------------------------------ view --

  function injectPanel() {
    if (!panelLoader.item) return;
    var p = panelLoader.item;
    p.bar = root.bar;
    p.anchorItem = button;
    p.hostWidget = root;
    p.settings = root.settings;
    // Bound, not assigned: an assignment would freeze the panel on whatever
    // was true when it was first injected.
    p.summary = Qt.binding(function () { return root.summary; });
    p.nowMs = Qt.binding(function () { return root.nowMs; });
    p.busy = Qt.binding(function () { return internal.inFlight; });
  }

  onBarChanged: root.injectPanel()
  onSettingsChanged: root.injectPanel()

  Loader {
    id: panelLoader
    active: true
    visible: false
    source: Qt.resolvedUrl("Panel.qml")
    onLoaded: {
      root.injectPanel();
      // `bar` arrives after construction; a second pass on the next tick is
      // what makes the panel pick up the theme.
      Qt.callLater(root.injectPanel);
    }
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    slotSize: Style.bar.statusSlot
    tooltipText: Model.tooltip(root.summary, root.nowMs)

    iconComponent: Component {
      Mark {
        level: root.summary.level
        unreadCount: root.summary.unread.length
        foreground: button.foreground
        glyphSize: Style.font.caption
        stale: root.summary.stale
        busy: internal.inFlight && root.summary.level === "loading"
      }
    }

    // Left: the panel. Middle: straight to today's edition on the site.
    onPressed: function (buttonCode) {
      if (buttonCode === Qt.LeftButton) {
        root.toggle();
      } else if (buttonCode === Qt.MiddleButton && root.summary.latest) {
        root.markRead(root.summary.latest.date);
        root.openUrl(root.summary.latest.url);
      }
    }
  }
}
