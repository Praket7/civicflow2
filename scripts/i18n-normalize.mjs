const SKIP_ELEMENTS = new Set(["code", "kbd", "pre", "samp", "script", "style", "textarea"]);

/** Collapse JSX's formatting whitespace without changing the visible sentence. */
export function normalizeJsxText(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

export function hasLetters(text) {
  return /\p{L}/u.test(text);
}

function isInlineNode(node) {
  if (!node) return false;
  return (
    node.type === "JSXElement" ||
    node.type === "JSXFragment" ||
    node.type === "JSXExpressionContainer"
  );
}

/**
 * JSX text nodes next to an inline element need their boundary space kept.
 * Formatting-only whitespace at the start or end of a block does not.
 */
export function keepsBoundarySpace(raw, previous, next) {
  // A literal space inside an only-child text node (`<span> families`) is part
  // of the sentence even though the span itself is the inline neighbour. Keep
  // it; indentation that starts with a newline is formatting and is dropped.
  return {
    leading: raw.startsWith(" ") && (isInlineNode(previous) || !previous),
    trailing: raw.endsWith(" ") && (isInlineNode(next) || !next),
  };
}

export function shouldSkipElement(elementName) {
  return Boolean(elementName && SKIP_ELEMENTS.has(elementName));
}

/**
 * Copy that is rendered straight from a JSX expression container, as in
 * `{short ? "Role gap" : "Fully covered"}`. Boundary whitespace is left alone
 * because dropping it would change the visible text, and a plural or unit
 * fragment ("s", "ies") is not a sentence a translator can work from.
 */
/** Values in copy position that are records, not interface text. */
const NOT_COPY = new Set([
  // Venue fallback for an event with no recorded address.
  "214 Rivergate Avenue, Buffalo",
]);

export function isRenderedCopy(value) {
  if (value !== value.trim()) return false;
  if (!value || !hasLetters(value) || value.includes("@")) return false;
  if (NOT_COPY.has(value)) return false;
  return value.includes(" ") || value.length >= 4;
}

/**
 * The literals an expression container can render as text: the expression
 * itself, a ternary branch, or a side of `&&`/`||`. Anything else — a call, a
 * lookup, an array — is a value, not copy.
 */
export function collectRenderedLiterals(node, add) {
  if (!node) return;
  if (node.type === "StringLiteral") {
    add(node);
    return;
  }
  if (node.type === "ConditionalExpression") {
    collectRenderedLiterals(node.consequent, add);
    collectRenderedLiterals(node.alternate, add);
    return;
  }
  if (node.type === "LogicalExpression") {
    collectRenderedLiterals(node.left, add);
    collectRenderedLiterals(node.right, add);
  }
}
