.pragma library

// Status colour, glyphs and labels. Pure, QML-free, testable.
//
// Same rule as the other m0u plugins: chrome inherits the bar foreground, and
// only meaning gets a hard-coded colour. A theme is free to make its foreground
// any colour at all, so colour never carries a status alone. Every status also
// has a glyph and a word.

// Laravel red. Used for one thing only: "there is an edition you have not
// read". Anything else in red would dilute it.
var BRAND = "#FF2D20";

var STATUS = {
  released: { color: "#10B981", glyph: "\uF02B", label: "Release" },       // nf-fa-tag
  merged: { color: "#A78BFA", glyph: "\uF419", label: "Merged" },          // nf-oct-git_merge
  recommended: { color: "#F59E0B", glyph: "\uF005", label: "Dica" },       // nf-fa-star
  note: { color: "#94A3B8", glyph: "\uF05A", label: "Nota" }               // nf-fa-info_circle
};

// Written as escapes, never as literal characters: Nerd Font codepoints live in
// the private use area, and anything that is not byte-transparent turns a
// literal one into an empty string with no visual signal at all. Every
// codepoint here was checked against JetBrainsMono Nerd Font's cmap.
var ICONS = {
  "mug": "\uDB80\uDD76",     // nf-md-coffee (U+F0176), the bar mark
  "laravel": "\uE73F",       // nf-dev-laravel
  "prev": "\uF053",          // nf-fa-chevron_left
  "next": "\uF054",          // nf-fa-chevron_right
  "external": "\uF08E",      // nf-fa-external_link
  "refresh": "\uF021",       // nf-fa-refresh
  "attention": "\uF0E7",     // nf-fa-bolt
  "caret-down": "\uF0D7",    // nf-fa-caret_down
  "caret-right": "\uF0DA",   // nf-fa-caret_right
  "github": "\uF09B",        // nf-fa-github
  "offline": "\uF1EB",       // nf-fa-wifi
  "check": "\uF00C"          // nf-fa-check
};

function status(key) {
  return STATUS[key] || STATUS.note;
}

function colorFor(key) {
  return status(key).color;
}

function glyphFor(key) {
  return status(key).glyph;
}

function labelFor(key) {
  return status(key).label;
}

function icon(name) {
  return ICONS[name] || "";
}
