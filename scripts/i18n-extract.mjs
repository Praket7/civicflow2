import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import {
  collectRenderedLiterals,
  hasLetters,
  isRenderedCopy,
  normalizeJsxText,
  shouldSkipElement,
} from "./i18n-normalize.mjs";

const COPY_ATTRIBUTES = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "backLabel",
  "caption",
  "centerLabel",
  // `copy` is body text for EmptyState, which translates it itself. It is
  // collected here and left alone by the JSX transform so the sentence is
  // never looked up twice.
  "copy",
  "description",
  "empty",
  "eyebrow",
  "hint",
  "label",
  "legend",
  "meta",
  "placeholder",
  "subtitle",
  "summary",
  "title",
]);

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      // `pwa` and `sync` are the volunteer client. It is a separate surface
      // with its own entry and is not wired to the coordinator's translator,
      // so its copy must not enter this catalog untranslated.
      if (
        entry.name === "i18n" ||
        entry.name === "node_modules" ||
        entry.name === "pwa" ||
        entry.name === "sync"
      )
        continue;
      files.push(...collectFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Modules without JSX keep their copy in t() calls, so a .ts file is only read
 * when it imports the translator. An unrelated helper that happens to be named
 * `t` cannot contribute strings.
 */
function importsTranslate(ast) {
  return ast.program.body.some(
    (node) =>
      node.type === "ImportDeclaration" &&
      String(node.source.value).includes("i18n") &&
      node.specifiers.some(
        (specifier) => specifier.type === "ImportSpecifier" && specifier.imported.name === "t",
      ),
  );
}

function elementName(node) {
  const name = node.openingElement?.name;
  return name?.type === "JSXIdentifier" ? name.name : null;
}

function insideSkippedElement(path) {
  let current = path.parentPath;
  while (current) {
    if (current.isJSXElement() && shouldSkipElement(elementName(current.node))) return true;
    current = current.parentPath;
  }
  return false;
}

const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "leadingComments", "trailingComments"]);

/** Every plain string inside an expression, skipping interpolated templates. */
function collectLiterals(node, add) {
  if (!node || typeof node !== "object") return;
  if (node.type === "StringLiteral") {
    add(node.value);
    return;
  }
  if (node.type === "TemplateLiteral") {
    if (node.expressions.length > 0) return;
    for (const quasi of node.quasis) add(quasi.value.cooked ?? quasi.value.raw);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => collectLiterals(child, add));
    else if (value && typeof value === "object" && typeof value.type === "string") {
      collectLiterals(value, add);
    }
  }
}

const strings = new Set();
for (const file of collectFiles("src")) {
  const source = readFileSync(file, "utf8");
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (error) {
    console.warn(`skip ${file}: ${error.message}`);
    continue;
  }

  if (file.endsWith(".ts") && !importsTranslate(ast)) continue;

  traverse(ast, {
    // Copy is not only JSX: labels, empty states, and question text are also
    // passed straight to t(). Collect literals anywhere inside that argument,
    // so `t(cond ? "A" : "B")` contributes both labels. A template with an
    // interpolation is skipped: its runtime key is not the literal chunk.
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== "Identifier" || callee.name !== "t") return;
      collectLiterals(path.node.arguments[0], (text) => {
        const key = text.trim();
        if (key && hasLetters(key)) strings.add(key);
      });
    },
    JSXText(path) {
      if (insideSkippedElement(path)) return;
      const value = normalizeJsxText(path.node.value);
      if (value && hasLetters(value)) strings.add(value);
    },
    // `{short ? "Role gap" : "Fully covered"}` is copy like any other, but it
    // is not JSX text and not an attribute value, so it needs its own pass.
    JSXExpressionContainer(path) {
      const parent = path.parentPath.node;
      if (parent.type === "JSXAttribute" || parent.type === "JSXSpreadAttribute") return;
      if (insideSkippedElement(path)) return;
      collectRenderedLiterals(path.node.expression, (node) => {
        if (!isRenderedCopy(node.value)) return;
        strings.add(node.value.trim());
      });
    },
    JSXAttribute(path) {
      const name = path.node.name;
      if (name.type !== "JSXIdentifier" || !COPY_ATTRIBUTES.has(name.name)) return;
      const value = path.node.value;
      if (!value || value.type !== "StringLiteral") return;
      const text = value.value.trim();
      if (text && hasLetters(text)) strings.add(text);
    },
  });
}

for (const value of JSON.parse(readFileSync("src/lib/i18n/manual-strings.json", "utf8"))) {
  if (typeof value === "string" && value.trim()) strings.add(value.trim());
}

const sorted = [...strings].sort((a, b) => a.localeCompare(b, "en"));
writeFileSync("src/lib/i18n/strings.json", `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`${sorted.length} interface strings`);
