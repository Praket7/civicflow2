/**
 * Release version gate.
 *
 * A tag is only meaningful if every manifest agrees with it. The desktop
 * updater reads `tauri.conf.json`, the installer filenames read the Cargo
 * package version, and the documentation quotes `package.json`. One stale
 * value produces an installer that cannot update itself.
 *
 * Usage:
 *   node scripts/check-release-version.mjs v0.1.1
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";

if (!tag.startsWith("v")) {
  console.error(`Expected a v-prefixed tag, received “${tag || "(none)"}”.`);
  process.exit(1);
}

const packageVersion = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")).version;
const tauriVersion = JSON.parse(readFileSync(`${ROOT}/src-tauri/tauri.conf.json`, "utf8")).version;
const shellVersion = readFileSync(`${ROOT}/src-tauri/Cargo.toml`, "utf8").match(
  /^version = "([^"]+)"/m,
)?.[1];
const coreVersion = readFileSync(`${ROOT}/src-tauri/core/Cargo.toml`, "utf8").match(
  /^version = "([^"]+)"/m,
)?.[1];

const versions = {
  "package.json": packageVersion,
  "src-tauri/tauri.conf.json": tauriVersion,
  "src-tauri/Cargo.toml": shellVersion,
  "src-tauri/core/Cargo.toml": coreVersion,
};
const problems = [];
for (const [file, version] of Object.entries(versions)) {
  if (!version) problems.push(`${file} has no version.`);
  else if (version !== packageVersion) {
    problems.push(`${file} is ${version}; package.json is ${packageVersion}.`);
  }
}
if (tag !== `v${packageVersion}`) {
  problems.push(`Tag is ${tag}; the manifests say v${packageVersion}.`);
}

if (problems.length > 0) {
  console.error("Release version check failed:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nBump every manifest and the tag together.");
  process.exit(1);
}

console.log(`Release version check passed: ${tag} across four manifests.`);
