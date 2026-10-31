/**
 * Help coverage gate.
 *
 * Every registered screen must have an entry in `src/lib/help/topics.ts`, every
 * entry must point at a screen that still exists, and every parameterised route
 * must have a resolver. A screen without help is a dead end for a new
 * coordinator; an entry without a screen is a broken promise in the UI.
 *
 * Usage:
 *   node scripts/check-help-coverage.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const routesSource = readFileSync(`${ROOT}/src/app/routes.ts`, "utf8");
const topicsSource = readFileSync(`${ROOT}/src/lib/help/topics.ts`, "utf8");

const routeIds = [...routesSource.matchAll(/^\s{4}id: "([^"]+)",$/gm)].map((match) => match[1]);
const routePaths = new Map(
  [...routesSource.matchAll(/^\s{4}id: "([^"]+)",\n(?:.*\n)*?\s{4}path: "([^"]+)",$/gm)].map(
    (match) => [match[1], match[2]],
  ),
);

const topicsStart = topicsSource.indexOf("export const helpTopics");
const topicsEnd = topicsSource.indexOf("const byId");
if (topicsStart === -1 || topicsEnd === -1) {
  console.error("Could not find the helpTopics registry in src/lib/help/topics.ts.");
  process.exit(1);
}
const topicsBlock = topicsSource.slice(topicsStart, topicsEnd);
const topicIds = [...topicsBlock.matchAll(/^\s{4}id: "([^"]+)",$/gm)].map((match) => match[1]);

const problems = [];
const missing = routeIds.filter((id) => !topicIds.includes(id));
const extra = topicIds.filter((id) => !routeIds.includes(id));
const duplicates = topicIds.filter((id, index) => topicIds.indexOf(id) !== index);

for (const id of missing) problems.push(`Route “${id}” has no help entry.`);
for (const id of extra) problems.push(`Help entry “${id}” does not name a registered route.`);
for (const id of new Set(duplicates))
  problems.push(`Help entry “${id}” is defined more than once.`);

// Every topic needs a purpose and a first step; an empty drawer is worse than
// no drawer because it looks like the answer is missing.
for (const match of topicsBlock.matchAll(
  /^\s{4}id: "([^"]+)",\n\s{4}title: "([^"]+)",\n\s{4}purpose: "([^"]*)",\n\s{4}steps: \[([\s\S]*?)\n\s{4}\],/gm,
)) {
  const [, id, title, purpose, steps] = match;
  if (purpose.trim().length < 20) problems.push(`Help entry “${id}” has no useful purpose.`);
  if (!title.trim()) problems.push(`Help entry “${id}” has no title.`);
  if (!/"[^"]+"/.test(steps)) problems.push(`Help entry “${id}” has no steps.`);
}

// A parameterised resolver must still point at a route that exists, and its
// prefix must be the route path with the parameter removed.
const resolverBlock = topicsSource.slice(
  topicsSource.indexOf("const PARAMETERISED"),
  topicsSource.indexOf("/** Resolve the help entry"),
);
const resolvers = [...resolverBlock.matchAll(/\{ prefix: "([^"]+)", id: "([^"]+)" \}/g)];
for (const match of resolvers) {
  const [, prefix, id] = match;
  if (!routeIds.includes(id)) problems.push(`Parameterised resolver names unknown route “${id}”.`);
  const routePath = routePaths.get(id);
  if (!routePath || !routePath.includes(":")) {
    problems.push(`Resolver “${prefix}” points at “${id}”, which is not a parameterised route.`);
    continue;
  }
  if (!routePath.startsWith(prefix)) {
    problems.push(`Resolver prefix “${prefix}” does not match route path “${routePath}”.`);
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} help coverage problem${problems.length === 1 ? "" : "s"}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\nAdd or fix the entry in src/lib/help/topics.ts.");
  process.exit(1);
}

console.log(
  `Help coverage passed: ${routeIds.length} routes, ${topicIds.length} topics, ${resolvers.length} resolvers.`,
);
