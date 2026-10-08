.pragma library

// Fixed argv for the two things this plugin launches. Pure; BarWidget.qml
// hands the result to Util.execArgv, which passes every element as a
// positional parameter — nothing from the feed is ever parsed by a shell.

function openUrlArgv(url) {
  var u = typeof url === "string" ? url : "";
  if (!/^https?:\/\/[^\s"'<>]+$/.test(u))
    return [];
  return ["xdg-open", u];
}

// A toast whose click opens the panel. `notify-send --wait` blocks until the
// toast is clicked or dismissed and prints the action id, so the script is
// constant and the data rides in $1..$4. Run detached, it can wait as long as
// the toast lives without holding anything in the shell.
var NOTIFY_SCRIPT =
  'a=$(notify-send --app-name="$1" --icon="$2" --action=default=Ler --wait -- "$3" "$4") || exit 0; ' +
  '[ "$a" = default ] && exec qs -p /usr/share/omarchy/shell ipc call m0u.artisan open';

function notifyArgv(title, body, iconPath) {
  if (!title)
    return [];
  return ["bash", "-c", NOTIFY_SCRIPT, "bom-dia-artisan",
    "Bom Dia, Artisan", String(iconPath || "dialog-information"), String(title), String(body || "")];
}
