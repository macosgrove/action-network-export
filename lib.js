/**
 * Shared utilities for Action Network data export.
 * Handles API requests, pagination, rate limiting, and CSV writing.
 */
import axios from "axios";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_BASE_V1 = "https://actionnetwork.org/api/v1";
const API_BASE_V2 = "https://actionnetwork.org/api/v2";
const REQUEST_DELAY_MS = 300; // polite rate-limiting between pages
const REQUEST_TIMEOUT_MS = 30_000;

export function getApiKey() {
  // Prefer env var (set by Claude Code from .claude/settings.local.json), then fall back to reading the file directly.
  if (process.env.ACTION_NETWORK_API_KEY) return process.env.ACTION_NETWORK_API_KEY;

  try {
    const raw = fs.readFileSync(new URL("../.claude/settings.local.json", import.meta.url), "utf-8");
    const key = JSON.parse(raw)?.env?.ACTION_NETWORK_API_KEY;
    if (key) return key;
  } catch {
    // file missing or unreadable — fall through to error
  }

  console.error("ERROR: ACTION_NETWORK_API_KEY not found. Add it to .claude/settings.local.json under env.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Make a single API request with retry on transient errors (429, 5xx).
 * Returns the parsed JSON body.
 */
const MAX_RETRIES = 3;

export async function apiGet(version, endpoint, params = {}) {
  const baseUrl = version === "v1" ? API_BASE_V1 : API_BASE_V2;
  const apiKey = getApiKey();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await axios({
        method: "GET",
        url: `${baseUrl}/${endpoint}`,
        params,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          "api-key": apiKey,
          "OSDI-API-Token": apiKey,
          Accept: "application/json",
        },
      });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const retryable = status === 429 || (status >= 500 && status < 600) || err.code === "ECONNRESET";
      if (retryable && attempt < MAX_RETRIES) {
        const backoff = attempt * 2000;
        console.log(`  ⏳ ${status || err.code} on ${endpoint} — retrying in ${backoff / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Extract the UUID from an Action Network self-link href.
 * e.g. "https://actionnetwork.org/api/v1/people/abc-123" → "abc-123"
 */
export function extractId(href) {
  if (!href) return "";
  return href.split("/").pop();
}

/**
 * Paginate through an Action Network list endpoint, yielding all embedded
 * resources across every page.
 *
 * @param {string} version  "v1" or "v2"
 * @param {string} endpoint  e.g. "people" or "tags/xxx/taggings"
 * @param {string} collectionKey  the key inside _embedded, e.g. "osdi:people"
 * @param {object} extraParams  additional query params (e.g. filters)
 * @returns {AsyncGenerator<object>}  yields one resource object per iteration
 */
export async function* paginate(version, endpoint, collectionKey, extraParams = {}) {
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const data = await apiGet(version, endpoint, { ...extraParams, page, per_page: 25 });

    totalPages = data.total_pages || 1;
    const items = data._embedded?.[collectionKey] || [];

    for (const item of items) {
      yield item;
    }

    if (page % 10 === 0 || page === totalPages) {
      process.stdout.write(`  … page ${page}/${totalPages}\n`);
    }

    page++;
    if (page <= totalPages) await sleep(REQUEST_DELAY_MS);
  }
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/**
 * Escape a value for CSV output (RFC 4180).
 */
function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Write an array of flat objects to a CSV file.
 * Columns are derived from the union of all object keys (in insertion order
 * of the first object, then any extras alphabetically).
 */
export function writeCsv(filePath, rows) {
  if (rows.length === 0) {
    console.log(`  ⚠ No rows to write for ${filePath}`);
    return;
  }

  // Gather all column names
  const colSet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) colSet.add(key);
  }
  const columns = [...colSet];

  const header = columns.map(csvEscape).join(",");
  const lines = rows.map((row) =>
    columns.map((col) => csvEscape(row[col])).join(",")
  );

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(filePath, [header, ...lines].join("\n") + "\n", "utf-8");
  console.log(`  ✓ Wrote ${rows.length} rows → ${filePath}`);
}

// ---------------------------------------------------------------------------
// Output directory helper
// ---------------------------------------------------------------------------

/**
 * Returns the output directory for this export run, creating it if needed.
 * Defaults to ./output/<YYYY-MM-DD>/ so you get a dated snapshot each run.
 */
export function getOutputDir() {
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.resolve("output", date);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
