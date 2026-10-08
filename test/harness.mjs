// Loads the plugin's QML JavaScript files into node so `node --test` runs the
// EXACT files Quickshell loads — no parallel copy, no build step, no drift.
//
// The only transformation is stripping QML's `.pragma` / `.import` directives,
// which are the two lines node cannot parse and which carry no logic. Anything
// else that differs between the two environments is a bug in the file, and we
// want the test to see it.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// QML directives must be the first non-comment lines of the file; they are not
// JavaScript. Blank them rather than deleting them so line numbers in stack
// traces still match the real file.
function stripQmlDirectives(src) {
  return src.replace(/^\s*\.(pragma|import)\b.*$/gm, "");
}

// Top-level `function foo` and `var BAR` declarations — the only things a QML
// JS "library" can expose, since QML has no export syntax.
function declaredNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^var\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return [...names];
}

// Evaluated in THIS realm, not a fresh vm context: a sandboxed realm has its
// own Array/Object prototypes, which makes `assert.deepEqual([], [])` fail on
// cross-realm identity and would have every test lying about why.
export function load(name) {
  const file = join(ROOT, name);
  const src = stripQmlDirectives(readFileSync(file, "utf8"));
  const names = declaredNames(src);
  const factory = vm.runInThisContext(
    `(function () {\n${src}\nreturn { ${names.join(", ")} };\n})`,
    { filename: file }
  );
  return factory();
}

export function fixture(name) {
  return JSON.parse(readFileSync(join(ROOT, "test/fixtures", `${name}.json`), "utf8"));
}

export function fixtureNames() {
  return readdirSync(join(ROOT, "test/fixtures"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => basename(f, ".json"))
    .sort();
}
