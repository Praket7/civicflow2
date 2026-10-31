/**
 * License allowlist.
 *
 * The generated inventory is the source of truth: every npm package and Rust
 * crate that ships must resolve to a license this project can redistribute.
 * The check fails on anything outside the list, which includes GPL, AGPL,
 * SSPL, and packages with no license metadata at all.
 *
 * Legacy `/` expressions mean "or" in Cargo metadata, so they are normalized
 * before evaluation. A compound expression passes when at least one branch is
 * entirely allowed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const inventory = JSON.parse(readFileSync(`${ROOT}/src/data/thirdParty.json`, "utf8"));

const ALLOWED = new Set(
  [
    "0BSD",
    "Apache-2.0",
    "Apache-2.0 WITH LLVM-exception",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "CC0-1.0",
    "CDLA-Permissive-2.0",
    "ISC",
    "MIT",
    "MIT-0",
    "MPL-2.0",
    "OFL-1.1",
    "Unicode-3.0",
    "Unlicense",
    "Zlib",
  ].map((license) => license.toLowerCase()),
);

function branches(expression) {
  return String(expression ?? "")
    .replace(/[()]/g, " ")
    .replace(/\//g, " OR ")
    .split(/\s+OR\s+/i)
    .map((branch) =>
      branch
        .split(/\s+AND\s+/i)
        .map((term) => term.trim())
        .filter(Boolean),
    )
    .filter((terms) => terms.length > 0);
}

const problems = [];
for (const ecosystem of ["npm", "cargo"]) {
  for (const row of inventory[ecosystem] ?? []) {
    const expression = row.license ?? "";
    const acceptable = branches(expression).some((terms) =>
      terms.every((term) => ALLOWED.has(term.toLowerCase())),
    );
    if (!acceptable) {
      problems.push(`${ecosystem} ${row.name}@${row.version}: ${expression || "(no license)"}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`License check failed: ${problems.length} package(s) outside the allowlist.\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nReplace the dependency or add a reviewed SPDX identifier to scripts/check-licenses.mjs.",
  );
  process.exit(1);
}

console.log(
  `License check passed: ${inventory.npm.length} npm packages and ${inventory.cargo.length} crates.`,
);
