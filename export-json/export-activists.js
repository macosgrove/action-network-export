#!/usr/bin/env node
/**
 * Export all activist (people) data from Action Network to JSON.
 *
 * Retains the full raw API response for each person — no fields are dropped.
 *
 * Usage:
 *   node export-json/export-activists.js
 *   node export-json/export-activists.js --from 2026-01-01
 *   node export-json/export-activists.js --from 2026-01-01T00:00:00Z
 *   node export-json/export-activists.js --email person@example.com
 *
 * --from   filters to activists created at or after that datetime.
 *          Tries the Action Network server-side OSDI filter first; falls back
 *          to client-side filtering if the API plan doesn't support it.
 * --email  exports a single activist matching that email address.
 *
 * Output: output/<YYYY-MM-DD>/[prefix_]activists.json
 * The API key is read from .claude/settings.local.json (env.ACTION_NETWORK_API_KEY).
 */
import fs from "fs";
import path from "path";
import { paginate, apiGet, getOutputDir } from "../lib.js";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);

  const fromIdx = args.indexOf("--from");
  const fromRaw = fromIdx !== -1 ? args[fromIdx + 1] : null;
  let fromIso = null;
  if (fromRaw !== null) {
    const d = new Date(fromRaw);
    if (isNaN(d.getTime())) {
      console.error(`ERROR: Invalid --from value "${fromRaw}". Use an ISO 8601 date, e.g. 2026-01-01 or 2026-01-01T00:00:00Z`);
      process.exit(1);
    }
    fromIso = d.toISOString();
  }

  const emailIdx = args.indexOf("--email");
  const email = emailIdx !== -1 ? args[emailIdx + 1] : null;
  if (email !== null && !email.includes("@")) {
    console.error(`ERROR: Invalid --email value "${email}".`);
    process.exit(1);
  }

  return { fromIso, email };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function exportByEmail(email) {
  console.log(`\n👤 Exporting activist with email ${email} …`);
  const filterParam = `email_address eq '${email}'`;
  try {
    const data = await apiGet("v2", "people", { page: 1, per_page: 25, filter: filterParam });
    const people = data._embedded?.["osdi:people"] || [];
    if (people.length === 0) console.log("  No activist found with that email address.");
    return people;
  } catch (err) {
    throw new Error(`Email lookup failed: ${err.response?.status || err.message}`);
  }
}

async function exportActivists(fromIso) {
  const label = fromIso ? `created on or after ${fromIso}` : "all";
  console.log(`\n👥 Exporting activists (${label}) …`);

  const people = [];
  const filterParam = fromIso ? `created_date ge '${fromIso}'` : null;

  // Try server-side OSDI filter first (not available on all Action Network plans)
  if (filterParam) {
    let serverFilterWorks = false;
    try {
      console.log("  Trying server-side filter …");
      const probe = await apiGet("v2", "people", { page: 1, per_page: 25, filter: filterParam });
      serverFilterWorks = true;
      console.log(`  Server-side filter supported. Total matching: ${probe.total_records ?? "unknown"}`);

      for await (const person of paginate("v2", "people", "osdi:people", { filter: filterParam })) {
        people.push(person);
      }
    } catch (err) {
      if (!serverFilterWorks) {
        console.log(`  Server-side filter not available (${err.response?.status || err.message}). Falling back to client-side filtering …`);
      } else {
        throw err;
      }
    }

    if (serverFilterWorks) return people;
  }

  // No filter or server filter unavailable — fetch all and filter client-side
  let skipped = 0;
  for await (const person of paginate("v2", "people", "osdi:people")) {
    if (fromIso && (person.created_date || "") < fromIso) {
      skipped++;
      continue;
    }
    people.push(person);
  }
  if (skipped > 0) console.log(`  Skipped ${skipped} people created before cutoff.`);

  return people;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { fromIso, email } = parseArgs();

  let people;
  let prefix;

  if (email) {
    people = await exportByEmail(email);
    prefix = email.replace(/[^a-zA-Z0-9._-]/g, "_") + "_";
  } else {
    people = await exportActivists(fromIso);
    prefix = fromIso ? fromIso.replace(/[:.]/g, "-") + "_" : "";
  }

  const dir = getOutputDir();
  const outPath = path.join(dir, `${prefix}activists.json`);
  fs.writeFileSync(outPath, JSON.stringify(people, null, 2), "utf-8");

  console.log(`\n✅ Exported ${people.length} activist(s) → ${outPath}\n`);
}

main().catch((err) => {
  console.error("Export failed:", err.message);
  process.exit(1);
});
