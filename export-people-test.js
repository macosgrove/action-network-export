#!/usr/bin/env node
/**
 * TEST EXPORT: People created in the last month.
 *
 * Strategy:
 *   1. First tries Action Network's OSDI filter param (server-side).
 *   2. If filtering isn't supported (some AN plans don't allow it),
 *      falls back to fetching all people and filtering client-side,
 *      stopping early once records are older than the cutoff.
 *
 * Usage:
 *   ACTION_NETWORK_API_KEY=<key> node export-people-test.js
 *
 * Output:
 *   ./output/test/people-recent.csv
 */
import fs from "fs";
import path from "path";
import { paginate, apiGet, extractId, writeCsv } from "./lib.js";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Return an ISO-8601 date string for N days ago (UTC midnight). */
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Person → flat row
// ---------------------------------------------------------------------------

function personToRow(person, customFieldKeys) {
  const id =
    extractId(person._links?.self?.href) ||
    person.identifiers?.[0]?.replace("action_network:", "") ||
    "";

  const emails = person.email_addresses || [];
  const primaryEmail = emails.find((e) => e.primary)?.address || emails[0]?.address || "";
  const allEmails = emails.map((e) => e.address).join("; ");

  const phones = person.phone_numbers || [];
  const primaryPhone = phones.find((p) => p.primary)?.number || phones[0]?.number || "";

  const addr = (person.postal_addresses || [])[0] || {};

  const cf = person.custom_fields || {};
  for (const key of Object.keys(cf)) customFieldKeys.add(key);

  return {
    id,
    email: primaryEmail,
    all_emails: allEmails,
    given_name: person.given_name || "",
    family_name: person.family_name || "",
    phone: primaryPhone,
    address_line_1: (addr.address_lines || [])[0] || "",
    address_line_2: (addr.address_lines || [])[1] || "",
    locality: addr.locality || "",
    region: addr.region || "",
    postal_code: addr.postal_code || "",
    country: addr.country || "",
    languages_spoken: (person.languages_spoken || []).join("; "),
    created_date: person.created_date || "",
    modified_date: person.modified_date || "",
    ...Object.fromEntries(
      Object.entries(cf).map(([k, v]) => [`custom_${k}`, v])
    ),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cutoff = daysAgo(28); // ~1 month
  console.log(`\n🧪 Test export — people created since ${cutoff}\n`);

  const rows = [];
  const customFieldKeys = new Set();

  // --- Attempt 1: server-side filter via OSDI ---
  let useFilter = true;
  try {
    const filterParam = `created_date gt '${cutoff}'`;
    const probe = await apiGet("v2", "people", { page: 1, per_page: 25, filter: filterParam });
    // If we got here, the filter works — paginate with it
    console.log(`  Server-side filter supported (v2). Total records matching: ${probe.total_records ?? "unknown"}`);
    const items = probe._embedded?.["osdi:people"] || [];
    for (const person of items) {
      rows.push(personToRow(person, customFieldKeys));
    }
    // Fetch remaining pages if any
    const totalPages = probe.total_pages || 1;
    if (totalPages > 1) {
      for await (const person of paginate("v2", "people", "osdi:people", { filter: filterParam })) {
        // Skip page 1 items we already have (paginate starts from page 1)
        // Actually easier to just re-collect everything cleanly
      }
      // Cleaner: reset and paginate from scratch
      rows.length = 0;
      for await (const person of paginate("v2", "people", "osdi:people", { filter: filterParam })) {
        rows.push(personToRow(person, customFieldKeys));
      }
    }
  } catch (err) {
    useFilter = false;
    console.log(`  Server-side filter not available (${err.response?.status || err.message}).`);
    console.log(`  Falling back to client-side filtering …\n`);
  }

  // --- Attempt 2: client-side filter (fetch all, keep recent) ---
  if (!useFilter) {
    let skipped = 0;
    for await (const person of paginate("v2", "people", "osdi:people")) {
      const created = person.created_date || "";
      if (created >= cutoff) {
        rows.push(personToRow(person, customFieldKeys));
      } else {
        skipped++;
      }
    }
    if (skipped > 0) {
      console.log(`  Skipped ${skipped} people created before cutoff.`);
    }
  }

  // Write output
  const outDir = path.resolve("output", "test");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, "people-recent.csv");
  writeCsv(outPath, rows);

  console.log(`\n✅ Done — ${rows.length} people created in the last 28 days.`);
  if (customFieldKeys.size) {
    console.log(`   Custom fields found: ${[...customFieldKeys].join(", ")}`);
  }
}

main().catch((err) => {
  console.error("Test export failed:", err.message);
  process.exit(1);
});
