#!/usr/bin/env node
/**
 * Export activists who had one of the given tags applied on or after a cutoff date.
 *
 * Efficient, targeted approach: instead of fetching every person and all their
 * taggings, this pages through the taggings of ONLY the named tags, keeps those
 * created on/after the cutoff, unions the person ids, then fetches just those
 * people (with their full taggings) into a dated activists.json subset.
 *
 * Usage:
 *   node export-json/export-tagged-since.js --tags subscriber,member --since 2026-06-18
 *
 * --tags   comma-separated tag names to match (OR — any one qualifies). Case-insensitive.
 * --since  cutoff date (inclusive). A tagging qualifies if created_date >= this value.
 *          Plain dates (YYYY-MM-DD) are compared as UTC, matching the existing
 *          json-to-csv.js `created_after` convention.
 *
 * Output: output/<YYYY-MM-DD>/tagged-since-<since>_activists.json
 * The API key is read from .claude/settings.local.json (env.ACTION_NETWORK_API_KEY).
 */
import fs from "fs";
import path from "path";
import { paginate, apiGet, extractId, getOutputDir } from "../lib.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  const tagsRaw = get("--tags");
  const since = get("--since");

  if (!tagsRaw || !since) {
    console.error("Usage: node export-json/export-tagged-since.js --tags subscriber,member --since 2026-05-16");
    process.exit(1);
  }
  if (isNaN(new Date(since).getTime())) {
    console.error(`ERROR: Invalid --since value "${since}". Use an ISO date, e.g. 2026-05-16`);
    process.exit(1);
  }

  const tags = tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  return { tags, since };
}

async function fetchTagMap() {
  // id -> name, and name(lower) -> id
  const byId = {};
  const byName = {};
  for await (const tag of paginate("v2", "tags", "osdi:tags")) {
    const id = extractId(tag._links?.self?.href);
    if (!id) continue;
    byId[id] = tag.name || id;
    if (tag.name) byName[tag.name.toLowerCase()] = id;
  }
  return { byId, byName };
}

async function fetchTaggingsForPerson(personId, tagMapById) {
  const taggings = [];
  for await (const tagging of paginate("v2", `people/${personId}/taggings`, "osdi:taggings")) {
    const tagId = extractId(tagging._links?.["osdi:tag"]?.href);
    taggings.push({
      tag_id: tagId,
      tag_name: tagMapById[tagId] || tagId,
      created_date: tagging.created_date || "",
    });
  }
  return taggings;
}

async function main() {
  const { tags, since } = parseArgs();
  console.log(`\n🏷️  Tagged-since export — tags [${tags.join(", ")}], applied on/after ${since}\n`);

  console.log("  Fetching tag definitions …");
  const { byId, byName } = await fetchTagMap();
  console.log(`  Found ${Object.keys(byId).length} tags.`);

  // Resolve requested tag names -> ids
  const targets = [];
  for (const name of tags) {
    const id = byName[name];
    if (!id) {
      console.error(`  ⚠ Tag "${name}" not found in this Action Network account.`);
      continue;
    }
    targets.push({ name, id });
    console.log(`    "${name}" → ${id}`);
  }
  if (targets.length === 0) {
    console.error("ERROR: None of the requested tags exist. Aborting.");
    process.exit(1);
  }

  // Page through each target tag's taggings, keep those on/after cutoff.
  // Map personId -> { matchedTags: Set, earliestMatch: date }
  const matched = new Map();
  for (const { name, id } of targets) {
    let total = 0;
    let kept = 0;
    for await (const tagging of paginate("v2", `tags/${id}/taggings`, "osdi:taggings")) {
      total++;
      const created = tagging.created_date || "";
      if (created < since) continue; // string compare; ISO dates sort lexically
      const personId = extractId(tagging._links?.["osdi:person"]?.href);
      if (!personId) continue;
      kept++;
      const entry = matched.get(personId) || { tags: new Set(), earliest: created };
      entry.tags.add(name);
      if (created < entry.earliest) entry.earliest = created;
      matched.set(personId, entry);
    }
    console.log(`  "${name}": ${kept}/${total} taggings on/after ${since}`);
  }

  const personIds = [...matched.keys()];
  console.log(`\n  ${personIds.length} unique people matched (union of tags). Fetching person records …`);

  const people = [];
  let n = 0;
  for (const personId of personIds) {
    n++;
    try {
      const person = await apiGet("v2", `people/${personId}`);
      person.taggings = await fetchTaggingsForPerson(personId, byId);
      // annotate which target tags matched and the earliest qualifying date
      person._matched_tags = [...matched.get(personId).tags];
      person._earliest_match_date = matched.get(personId).earliest;
      people.push(person);
    } catch (err) {
      console.log(`  ⚠ Could not fetch person ${personId}: ${err.response?.status || err.message}`);
    }
    if (n % 25 === 0) process.stdout.write(`  … ${n}/${personIds.length}\n`);
  }

  const dir = getOutputDir();
  const outPath = path.join(dir, `tagged-since-${since}_activists.json`);
  fs.writeFileSync(outPath, JSON.stringify(people, null, 2), "utf-8");

  console.log(`\n✅ Exported ${people.length} activist(s) → ${outPath}\n`);
}

main().catch((err) => {
  console.error("Export failed:", err.message);
  process.exit(1);
});
