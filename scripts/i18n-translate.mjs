import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/lib/i18n";
const CATALOG_DIR = join(ROOT, "catalogs");
const locales = JSON.parse(readFileSync(join(ROOT, "locales.json"), "utf8"));
const strings = JSON.parse(readFileSync(join(ROOT, "strings.json"), "utf8"));

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, entry = "true"] = value.replace(/^--/, "").split("=");
    return [key, entry];
  }),
);

const requested = args.get("locale")
  ? args.get("locale").split(",")
  : locales.map((locale) => locale.code);
const force = args.has("force");
const missingOnly = args.has("missing-only");
const sleepMs = Number(args.get("sleep") ?? 240);
const concurrency = Math.max(1, Number(args.get("concurrency") ?? 1));

const TOKENS = [
  ["CivicFlow", "__CF0__"],
  ["AutoRoster", "__CF1__"],
  ["Rivergate Kitchen", "__CF2__"],
  ["Praket", "__CF3__"],
  ["Maya Chen", "__CF4__"],
  ["Buffalo", "__CF5__"],
  ["NYS", "__CF6__"],
  ["Pexels", "__CF8__"],
  ["Geist Mono", "__CF9__"],
  ["Geist", "__CF10__"],
  ["Source Serif 4", "__CF11__"],
  ["Source Serif", "__CF12__"],
  ["SQLite", "__CF13__"],
  ["Tauri", "__CF14__"],
  ["Lucide", "__CF15__"],
  ["GitHub", "__CF16__"],
];

function protect(text) {
  let output = text;
  for (const [term, token] of TOKENS) output = output.split(term).join(token);
  return output;
}

function restore(text) {
  let output = text;
  for (const [term, token] of TOKENS) output = output.split(token).join(term);
  return output;
}

const PLACEHOLDER = /\{[^}]+\}/g;

/**
 * Placeholders are ordinary text to a translator, so `{hours}` comes back as
 * `{ure}` and `{count}` can disappear outright. Swap each one for a sentinel
 * before the request and put the original braces back afterwards.
 */
function maskPlaceholders(text) {
  const names = [...new Set(text.match(PLACEHOLDER) ?? [])];
  let masked = text;
  names.forEach((name, index) => {
    masked = masked.split(name).join(`%%${index}%%`);
  });
  return { masked, names };
}

function unmaskPlaceholders(text, names) {
  return names.reduce((output, name, index) => output.split(`%%${index}%%`).join(name), text);
}

/** The distinct placeholders in a string, so a mangled translation is caught. */
function placeholderSignature(text) {
  return [...(text.match(PLACEHOLDER) ?? [])].sort().join("|");
}

function chunk(values) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const value of values) {
    const addition = value.length + 7;
    if (current.length > 0 && (size + addition > 3400 || current.length >= 70)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(value);
    size += addition;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A stalled connection used to hold a whole locale open until the process was
// killed. Cap each request so a dead route fails over to the relay instead.
const REQUEST_TIMEOUT_MS = 25_000;

function fetchWithTimeout(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

function joinQuery(texts, code) {
  return new URLSearchParams({
    client: "gtx",
    sl: "en",
    tl: code,
    dt: "t",
    q: texts.reduce((joined, text, index) => (index === 0 ? text : `${joined}\n@@@\n${text}`), ""),
  });
}

async function readTranslationResponse(response) {
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  }

  // A throttled endpoint answers with a redirect to a captcha page, so the
  // status is 200 and the body is HTML. Treat that as a rate limit instead of
  // letting JSON.parse fail and retrying a second later.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) throw new Error("HTTP 429 (blocked)");

  const payload = await response.json();
  const joined = (payload[0] ?? []).map((part) => part[0] ?? "").join("");
  return joined.split("@@@").map((part) => part.trim());
}

/**
 * The direct endpoint blocks a busy IP with a captcha redirect. A public CORS
 * relay fetches the same GET URL from its own address, which keeps a translation
 * run moving without a key of its own.
 */
async function requestThroughRelay(texts, code) {
  const target = `https://translate.googleapis.com/translate_a/single?${joinQuery(texts, code)}`;
  const response = await fetchWithTimeout(
    `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`relay HTTP ${response.status}`);
  }
  return readTranslationResponse(response);
}

async function requestTranslation(texts, code) {
  const query = joinQuery(texts, code);
  try {
    const response = await fetchWithTimeout("https://translate.googleapis.com/translate_a/single", {
      method: "POST",
      body: query,
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    });
    return await readTranslationResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/blocked|429|HTTP 5\d\d|Failed to fetch|aborted|timeout/i.test(message)) throw error;
    return requestThroughRelay(texts, code);
  }
}

async function translateChunk(texts, code, attempt = 0) {
  const masks = texts.map((text) => maskPlaceholders(protect(text)));
  try {
    const translated = await requestTranslation(
      masks.map((entry) => entry.masked),
      code,
    );
    if (translated.length !== texts.length) {
      throw new Error(`expected ${texts.length} parts, received ${translated.length}`);
    }
    const restored = translated.map((value, index) =>
      unmaskPlaceholders(restore(value), masks[index].names),
    );
    // A translation that renamed or dropped a placeholder would render a
    // literal `{count}` on screen, so retry the batch instead of keeping it.
    const damaged = restored.findIndex(
      (value, index) => placeholderSignature(value) !== placeholderSignature(texts[index]),
    );
    if (damaged >= 0) {
      throw new Error(`placeholder damaged in ${JSON.stringify(texts[damaged])}`);
    }
    return restored;
  } catch (error) {
    if (attempt >= 8) throw error;
    const blocked = error.message.includes("blocked");
    const delay = blocked ? 45_000 : error.message.includes("429") ? 15_000 : 1200 * (attempt + 1);
    if (blocked) console.log(`${code}: throttled, waiting ${Math.round(delay / 1000)}s`);
    await wait(delay);
    return translateChunk(texts, code, attempt + 1);
  }
}

async function translateLocale(meta) {
  const { code } = meta;
  if (code === "en") return;

  const path = join(CATALOG_DIR, `${code}.json`);
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  // An entry that still holds its English source is waiting for a translation,
  // which is what a key added while the endpoint was unreachable looks like. A
  // single-word key can legitimately read the same in both languages, so only
  // sentence-length entries are re-requested.
  const untranslated = (string) =>
    !existing[string] || (!missingOnly && existing[string] === string && string.includes(" "));
  if (!force && !strings.some(untranslated)) {
    console.log(`${code}: complete (${Object.keys(existing).length})`);
    return;
  }

  const missing = strings.filter((string) => force || untranslated(string));
  console.log(`${code}: translating ${missing.length} strings`);
  let completed = 0;

  for (const batch of chunk(missing)) {
    try {
      const translated = await translateChunk(batch, code);
      batch.forEach((string, index) => {
        existing[string] = translated[index] || string;
      });
      completed += batch.length;
      // Keep the committed two-space layout so a run leaves a readable diff.
      writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`);
      console.log(`${code}: ${completed}/${missing.length}`);
    } catch (error) {
      console.error(`${code}: batch failed after retries — ${error.message}`);
      // Keep whatever already succeeded; the next run resumes the gap.
    }
    await wait(sleepMs);
  }
}

mkdirSync(CATALOG_DIR, { recursive: true });
const queue = requested
  .map((code) => locales.find((locale) => locale.code === code))
  .filter(Boolean);

async function worker() {
  while (queue.length > 0) {
    const meta = queue.shift();
    try {
      await translateLocale(meta);
    } catch (error) {
      console.error(`${meta.code}: failed — ${error.message}`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
