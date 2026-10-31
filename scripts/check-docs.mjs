/**
 * Documentation gate.
 *
 * README.md is the only project-state document. LICENSE, the generated
 * third-party notice, and the media license are legal artifacts, not a second
 * description of the product. The release checklist is an operational
 * procedure, not a second description of the product, so it is allowed by
 * name. This checks that README links resolve, that the generated facts block
 * is current, and that no other project document has crept back into the tree.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const README = join(ROOT, "README.md");
const problems = [];

if (!existsSync(README)) {
  console.error("README.md is missing.");
  process.exit(1);
}
const text = readFileSync(README, "utf8");

const required = [
  "## Product",
  "## Architecture",
  "## Organization and access",
  "## AutoRoster",
  "## Data model",
  "## Security",
  "## Accessibility",
  "## Testing",
  "## Install",
  "## Build and run",
  "## Validation",
  "## Credits",
  "## Known limits",
];
for (const heading of required) {
  if (!text.includes(heading)) problems.push(`README is missing section "${heading}"`);
}

if (!text.includes("<!-- CIVICFLOW_FACTS_START -->")) {
  problems.push("README is missing the generated facts block");
} else {
  try {
    execFileSync(process.execPath, [join(ROOT, "scripts/update-readme-facts.mjs"), "--check"], {
      stdio: "pipe",
    });
  } catch {
    problems.push("README facts block is stale; run `pnpm docs:update`");
  }
}

const links = [...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
for (const link of links) {
  if (/^(?:https?:|mailto:|#)/.test(link)) continue;
  const target = link.split("#")[0];
  if (!existsSync(resolve(dirname(README), decodeURI(target)))) {
    problems.push(`README links to a missing file: ${link}`);
  }
}

for (const line of text.split("\n")) {
  if (/\b\d+\s+(?:registered\s+)?(?:routes|frontend tests|Rust tests|tables)\b/i.test(line)) {
    problems.push(`README hard-codes a volatile count: ${line.trim()}`);
  }
}

function* markdown(dir) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === "node_modules" || entry === "target" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(join(ROOT, path)).isDirectory()) yield* markdown(path);
    else if (entry.endsWith(".md")) yield path;
  }
}

const LEGAL_DOCUMENTS = new Set(["THIRD_PARTY_NOTICES.md", "public/media/LICENSE.md"]);
const OPERATIONAL_DOCUMENTS = new Set(["docs/RELEASE-CHECKLIST.md"]);
const extra = [...markdown(".")].filter(
  (path) => path !== "README.md" && !LEGAL_DOCUMENTS.has(path) && !OPERATIONAL_DOCUMENTS.has(path),
);
for (const path of extra) problems.push(`Second project document found: ${path}`);

if (problems.length > 0) {
  console.error("Documentation check failed:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("Documentation check passed.");
