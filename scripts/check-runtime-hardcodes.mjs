/**
 * Runtime hardcode gate.
 *
 * A demo fixture may name its own records and pin its own clock. Production
 * code may not: an identifier such as `vol-maya` or a date such as `2026-10-07`
 * inside a screen or a domain rule means the app is reading the fixture instead
 * of the workspace, and it will be wrong the first time somebody runs it for a
 * real organization.
 *
 * The gate permits fixtures only where they are defined: the authored demo
 * data, the browser preview adapter, tests, and migrations that backfill a
 * known historical row. Everything else must derive the value.
 *
 * Usage:
 *   node scripts/check-runtime-hardcodes.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Directories that hold production code. */
const SCANNED = ["src", "src-tauri/core/src", "src-tauri/src"];

/** Files that legitimately define fixture data or assert against it. */
const ALLOWED = [
  /^src\/test\//,
  /^src\/lib\/workspace\/previewRepository\.ts$/,
  /^src\/lib\/organizations\/preview\.ts$/,
  /^src\/lib\/i18n\//,
  /\.test\.[cm]?[jt]sx?$/,
  /^src-tauri\/core\/migrations\//,
  /^src-tauri\/core\/src\/db\.rs$/, // embeds the authored seed, does not invent ids
];

const RULES = [
  { pattern: /\bvol-maya\b/, label: "demo volunteer id" },
  { pattern: /\bsh-sat-food\b/, label: "demo shift id" },
  { pattern: /\borg-rivergate-kitchen\b/, label: "demo organization id" },
  // An ISO date literal in production code means a period was hardcoded. The
  // demo clock lives in the authored fixture, not in a screen.
  { pattern: /\b20\d{2}-\d{2}-\d{2}T\d{2}:/, label: "hardcoded timestamp" },
  { pattern: /\b20\d{2}-(?:0[1-9]|1[0-2])-\d{2}\b/, label: "hardcoded date" },
];

const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".rs"]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    const full = join(ROOT, path);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "target" || entry === "dist") continue;
      yield* walk(path);
    } else if (CODE.has(extname(entry))) {
      yield path;
    }
  }
}

const problems = [];
for (const dir of SCANNED) {
  for (const path of walk(dir)) {
    if (ALLOWED.some((allowed) => allowed.test(path))) continue;
    const source = readFileSync(join(ROOT, path), "utf8");
    // Unit tests sit inside the module they cover in Rust. They may pin a clock
    // and name a record; the rule is about production behavior, so the scan
    // stops at the test module.
    const production = path.endsWith(".rs") ? source.split("#[cfg(test)]")[0] : source;
    const lines = production.split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        return;
      }
      for (const rule of RULES) {
        if (rule.pattern.test(line)) {
          problems.push({
            path,
            line: index + 1,
            label: rule.label,
            text: trimmed.slice(0, 120),
          });
        }
      }
    });
  }
}

if (problems.length > 0) {
  console.error("Runtime code reads demo fixtures directly:\n");
  for (const problem of problems) {
    console.error(`  ${relative("", problem.path)}:${problem.line}  ${problem.label}`);
    console.error(`    ${problem.text}`);
  }
  console.error("\nDerive the value from the workspace or move it into shared/demo-*.json.");
  process.exit(1);
}

console.log("Runtime hardcode check passed.");
