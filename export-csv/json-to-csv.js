#!/usr/bin/env node
/**
 * Convert an Action Network JSON activist export to SimplifiedInitialImport CSV format.
 *
 * Usage:
 *   node export-csv/json-to-csv.js <input.json>
 *   node export-csv/json-to-csv.js <input.json> --filter export-csv/filter.json
 * 
 *   node export-csv/json-to-csv.js output/2026-05-16/activists.json --filter export-csv/subscriber-filter.json
 *
 * Output: <input-dir>/<input-basename>_simplified.csv
 *
 * Filter config schema (optional):
 *   {
 *     "require_tags": [
 *       { "name": "member" },
 *       { "name": "resigned", "created_after": "2025-05-16", "created_before": "2026-05-16" }
 *     ],
 *     "exclude_tags": [
 *       { "name": "deceased" }
 *     ]
 *   }
 *
 * Tag name matching is case-insensitive.
 * The API key is read from .claude/settings.local.json (env.ACTION_NETWORK_API_KEY).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { writeCsv } from "../lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadCountryCodes() {
  const csvPath = path.join(__dirname, "2 letter country codes.csv");
  const lines = fs.readFileSync(csvPath, "utf-8").trim().split("\n").slice(1);
  const map = {};
  for (const line of lines) {
    const comma = line.indexOf(",");
    if (comma === -1) continue;
    const code = line.slice(0, comma).trim().toUpperCase();
    const name = line.slice(comma + 1).trim();
    map[code] = name;
  }
  return map;
}

const COUNTRY_NAMES = loadCountryCodes();

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const inputFile = args.find((a) => !a.startsWith("--"));
  if (!inputFile) {
    console.error("Usage: node export-json/json-to-csv.js <input.json> [--filter filter.json]");
    process.exit(1);
  }

  const filterIdx = args.indexOf("--filter");
  const filterFile = filterIdx !== -1 ? args[filterIdx + 1] : null;

  return { inputFile, filterFile };
}

// ---------------------------------------------------------------------------
// Field transforms
// ---------------------------------------------------------------------------

function formatPhone(phoneNumbers) {
  const ph = phoneNumbers?.find((p) => p.primary) || phoneNumbers?.[0];
  const raw = ph?.number;
  if (!raw) return "";
  // Strip leading +61 or 61, replace with 0
  return raw.replace(/^\+?61/, "0");
}

function earliestTaggingDate(taggings) {
  if (!taggings || taggings.length === 0) return null;
  const dates = taggings.map((t) => t.created_date).filter(Boolean).sort();
  return dates[0] || null;
}

function formatCountry(code) {
  if (!code) return "";
  return COUNTRY_NAMES[code.toUpperCase()] || code;
}

function formatDateAEST(isoString) {
  if (!isoString) return "";
  const utcMs = new Date(isoString).getTime();
  if (isNaN(utcMs)) return isoString;
  const aestMs = utcMs + 10 * 60 * 60 * 1000;
  const d = new Date(aestMs);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

// Extract YYYY-MM-DD prefix from a filename like "2026-04-14T00-00-00-000Z_activists.json"
// or "mac_an_humanistsaustralia.org_activists.json" (no date — returns null)
function extractDatePrefix(filePath) {
  const basename = path.basename(filePath);
  const match = basename.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function buildNotesValue(datePrefix) {
  const iso = datePrefix || new Date().toISOString().slice(0, 10);
  const [y, m, d] = iso.split("-");
  return `Exported from AN ${d}-${m}-${y}`;
}

function personToRow(person, notesValue) {
  const emails = person.email_addresses || [];
  const email = emails.find((e) => e.primary)?.address || emails[0]?.address || "";

  const addr = (person.postal_addresses || [])[0] || {};
  const state = person.custom_fields?.["State (AU)"] || addr.region || "";

  return {
    "First Name": person.given_name || "",
    "Last Name": person.family_name || "",
    "Mobile Phone": formatPhone(person.phone_numbers),
    "Email": email,
    "Address Line 1": (addr.address_lines || [])[0] || "",
    "City": addr.locality || "",
    "State": state,
    "Postcode": addr.postal_code || "",
    "Country": formatCountry(addr.country),
    "Acquisition Date": formatDateAEST(earliestTaggingDate(person.taggings) || person.created_date),
    "Notes": notesValue,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function tagMatches(taggings, rule) {
  const name = rule.name.toLowerCase();
  const match = taggings.find((t) => t.tag_name?.toLowerCase() === name);
  if (!match) return false;
  if (rule.created_after && match.created_date < rule.created_after) return false;
  if (rule.created_before && match.created_date >= rule.created_before) return false;
  return true;
}

function applyFilter(activists, filterConfig) {
  if (!filterConfig) return activists;

  const { require_tags = [], exclude_tags = [] } = filterConfig;

  return activists.filter((person) => {
    const taggings = person.taggings || [];

    for (const rule of require_tags) {
      if (!tagMatches(taggings, rule)) return false;
    }
    for (const rule of exclude_tags) {
      if (tagMatches(taggings, rule)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { inputFile, filterFile } = parseArgs();

  if (!fs.existsSync(inputFile)) {
    console.error(`ERROR: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const activists = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
  if (!Array.isArray(activists)) {
    console.error("ERROR: Input file must contain a JSON array of activists.");
    process.exit(1);
  }

  let filterConfig = null;
  if (filterFile) {
    if (!fs.existsSync(filterFile)) {
      console.error(`ERROR: Filter file not found: ${filterFile}`);
      process.exit(1);
    }
    filterConfig = JSON.parse(fs.readFileSync(filterFile, "utf-8"));
  }

  const subscribed = activists.filter((p) => {
    const emails = p.email_addresses || [];
    const primary = emails.find((e) => e.primary) || emails[0];
    return primary?.status == "subscribed";
  });
  const unsubscribedCount = activists.length - subscribed.length;

  const filtered = applyFilter(subscribed, filterConfig);

  const datePrefix = extractDatePrefix(inputFile);
  const notesValue = buildNotesValue(datePrefix);

  const rows = filtered.map((p) => personToRow(p, notesValue));

  const inputDir = path.dirname(inputFile);
  const inputBase = path.basename(inputFile, ".json");
  const filterSuffix = filterFile ? `_${path.basename(filterFile, ".json")}` : "";
  const outPath = path.join(inputDir, `${inputBase}${filterSuffix}_simplified.csv`);

  writeCsv(outPath, rows);

  // Summary
  const missingPhone = rows.filter((r) => !r["Mobile Phone"]).length;
  const missingName = rows.filter((r) => !r["First Name"] && !r["Last Name"]).length;
  const missingAddress = rows.filter((r) => !r["Address Line 1"]).length;

  console.log(`\n   Input records:   ${activists.length}`);
  if (unsubscribedCount) console.log(`   Unsubscribed:    ${unsubscribedCount} (excluded)`);
  if (filterConfig) console.log(`   After filtering: ${filtered.length}`);
  console.log(`   Rows written:    ${rows.length}`);
  if (missingPhone)   console.log(`   ⚠ Missing phone:   ${missingPhone}`);
  if (missingName)    console.log(`   ⚠ Missing name:    ${missingName}`);
  if (missingAddress) console.log(`   ⚠ Missing address: ${missingAddress}`);
  console.log();
}

main().catch((err) => {
  console.error("Conversion failed:", err.message);
  process.exit(1);
});
