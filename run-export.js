#!/usr/bin/env node
/**
 * Run all Action Network exports in sequence.
 *
 * Usage:
 *   node run-export.js
 *
 * The API key is read from .claude/settings.local.json (env.ACTION_NETWORK_API_KEY).
 *
 * Outputs dated CSV files into ./output/<YYYY-MM-DD>/
 */
import { getOutputDir } from "./lib.js";
import { exportPeople } from "./export-people.js";
import { exportDonations } from "./export-donations.js";
import { exportTags } from "./export-tags.js";

async function main() {
  const dir = getOutputDir();
  console.log(`\n🚀 Action Network Full Export`);
  console.log(`   Output directory: ${dir}\n`);

  const results = {};

  try {
    results.people = await exportPeople(dir);
  } catch (err) {
    console.error(`❌ People export failed: ${err.message}`);
  }

  try {
    results.donations = await exportDonations(dir);
  } catch (err) {
    console.error(`❌ Donations export failed: ${err.message}`);
  }

  try {
    results.tags = await exportTags(dir);
  } catch (err) {
    console.error(`❌ Tags export failed: ${err.message}`);
  }

  console.log("\n✅ Export complete. Summary:");
  if (results.people !== undefined) console.log(`   People:           ${results.people} rows`);
  if (results.donations !== undefined) console.log(`   Donations:        ${results.donations} rows`);
  if (results.tags !== undefined) {
    console.log(`   Tags:             ${results.tags.tags} tags`);
    console.log(`   Tag associations: ${results.tags.associations} rows`);
  }
  console.log(`\n   Files saved to: ${dir}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
