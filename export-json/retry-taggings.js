#!/usr/bin/env node
/**
 * Retry tag retrieval for subscribed activists whose taggings array is empty.
 *
 * Reads an existing activists JSON export, re-fetches taggings from the API
 * for any subscribed activist with no taggings recorded, and writes the
 * updated data back to the same file.
 *
 * Usage:
 *   node export-json/retry-taggings.js <activists.json>
 *
 * Outputs:
 *   - Updated <activists.json> (in place)
 *   - <activists-dir>/tagging-failures.json  — IDs of activists whose tag
 *     retrieval failed after retry
 *
 * The API key is read from .claude/settings.local.json (env.ACTION_NETWORK_API_KEY).
 */
import fs from "fs";
import path from "path";
import { paginate, extractId } from "../lib.js";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error("Usage: node export-json/retry-taggings.js <activists.json>");
    process.exit(1);
  }
  if (!fs.existsSync(inputFile)) {
    console.error(`ERROR: File not found: ${inputFile}`);
    process.exit(1);
  }
  return inputFile;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSubscribed(person) {
  const emails = person.email_addresses || [];
  const primary = emails.find((e) => e.primary) || emails[0];
  return primary?.status !== "unsubscribed";
}

async function fetchTagMap() {
  const map = {};
  for await (const tag of paginate("v2", "tags", "osdi:tags")) {
    const id = extractId(tag._links?.self?.href);
    if (id) map[id] = tag.name || id;
  }
  return map;
}

async function fetchTaggingsForPerson(personId, tagMap) {
  const taggings = [];
  for await (const tagging of paginate("v2", `people/${personId}/taggings`, "osdi:taggings")) {
    const tagId = extractId(tagging._links?.["osdi:tag"]?.href);
    taggings.push({
      tag_id: tagId,
      tag_name: tagMap[tagId] || tagId,
      created_date: tagging.created_date || "",
    });
  }
  return taggings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const inputFile = parseArgs();
  const activists = JSON.parse(fs.readFileSync(inputFile, "utf-8"));

  const needsRetry = activists.filter(
    (p) => isSubscribed(p) && (!p.taggings || p.taggings.length === 0)
  );

  if (needsRetry.length === 0) {
    console.log("✅ No subscribed activists with missing taggings found.");
    return;
  }

  console.log(`\n🏷️  Found ${needsRetry.length} subscribed activist(s) with no taggings. Fetching tag map …`);
  const tagMap = await fetchTagMap();
  console.log(`   ${Object.keys(tagMap).length} tags loaded.\n`);

  const failedIds = [];
  let successCount = 0;

  for (const person of needsRetry) {
    const personId = extractId(person._links?.self?.href);
    const email = person.email_addresses?.find((e) => e.primary)?.address || personId;
    process.stdout.write(`  Fetching taggings for ${email} … `);

    try {
      const taggings = await fetchTaggingsForPerson(personId, tagMap);
      person.taggings = taggings;
      process.stdout.write(`${taggings.length} tag(s)\n`);
      successCount++;
    } catch (err) {
      process.stdout.write(`FAILED (${err.message})\n`);
      failedIds.push({ id: personId, email, error: err.message });
    }
  }

  // Write updated activists back to the same file
  fs.writeFileSync(inputFile, JSON.stringify(activists, null, 2), "utf-8");
  console.log(`\n✅ Updated ${inputFile}`);

  // Write failure log
  const failurePath = path.join(path.dirname(inputFile), "tagging-failures.json");
  fs.writeFileSync(failurePath, JSON.stringify(failedIds, null, 2), "utf-8");

  console.log(`\n   Retried:   ${needsRetry.length}`);
  console.log(`   Succeeded: ${successCount}`);
  if (failedIds.length) {
    console.log(`   Failed:    ${failedIds.length} → ${failurePath}`);
  } else {
    console.log(`   Failed:    0`);
    console.log(`   (failure log written to ${failurePath} — empty)`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
