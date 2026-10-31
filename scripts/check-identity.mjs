/**
 * Identity gate.
 *
 * The bundled workspace is a demonstration. It must not borrow a real
 * nonprofit's name, address, email, or staff, because that misrepresents both
 * the organization and the product. Published release notes must not print a
 * demo password either: a password in a public release is not a credential, it
 * is a liability.
 *
 * Usage:
 *   node scripts/check-identity.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const TEXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".sql",
  ".rs",
  ".html",
  ".toml",
]);
const SKIP = ["node_modules", "dist", "target", ".git", ".secrets", "pnpm-lock.yaml"];

const RULES = [
  { pattern: /feedmore/i, label: "real organization name" },
  { pattern: /\bholt\s+(street|st)\b/i, label: "real organization address" },
  { pattern: /@gmail\.com/i, label: "personal email domain in demo data" },
  {
    pattern: /buffalo\s+(greenway|public library|parks conservancy|together)/i,
    label: "real partner organization",
  },
  { pattern: /spca\s+serving\s+erie\s+county/i, label: "real partner organization" },
  { pattern: /meals\s+on\s+wheels\s+wny/i, label: "real partner organization" },
  { pattern: /org\.feedmore/i, label: "bundle identifier borrowed from a real organization" },
  { pattern: /Volunteer!\d{4}/, label: "previously published demo password pattern" },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (SKIP.some((skip) => path.includes(skip))) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (TEXT.has(extname(entry))) yield relative(ROOT, path);
  }
}

const problems = [];
for (const path of walk(ROOT)) {
  // The gate quotes the strings it bans; that is not a leak.
  if (path === "scripts/check-identity.mjs") continue;
  const lines = readFileSync(join(ROOT, path), "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        problems.push({
          path,
          line: index + 1,
          label: rule.label,
          text: line.trim().slice(0, 120),
        });
      }
    }
  });
}

// Release notes are the one place where a demo password would become a public
// credential rather than a fixture. The local demo password may exist in test
// source; it may not be printed in a release document.
const releaseNotes = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
if (/civicflow-demo/.test(releaseNotes)) {
  problems.push({
    path: ".github/workflows/release.yml",
    line: 1,
    label: "demo password printed in release notes",
    text: "Remove the credential and point at the password-free demo button.",
  });
}

if (problems.length > 0) {
  console.error(`${problems.length} identity problem${problems.length === 1 ? "" : "s"}:\n`);
  for (const problem of problems) {
    console.error(`  ${problem.path}:${problem.line}  ${problem.label}`);
    console.error(`    ${problem.text}`);
  }
  console.error("\nUse the fictional Rivergate Community Kitchen workspace instead.");
  process.exit(1);
}

console.log("Identity check passed: fictional demo organization, no published demo password.");
