#!/usr/bin/env node
/**
 * Export all tags and their person-tag associations from Action Network to CSV.
 *
 * Produces two files:
 *   - tags.csv           — tag id, name, created_date, modified_date
 *   - tag_associations.csv — tag_id, tag_name, person_id, created_date
 *
 * Uses the v2 API (tags require v2).
 */
import path from "path";
import { paginate, extractId, writeCsv, getOutputDir } from "./lib.js";

export async function exportTags(outputDir) {
  const dir = outputDir || getOutputDir();
  console.log("\n🏷️  Exporting tags …");

  const tagRows = [];
  const assocRows = [];

  // First pass: collect all tags
  for await (const tag of paginate("v2", "tags", "osdi:tags")) {
    const tagId =
      extractId(tag._links?.self?.href) ||
      tag.identifiers?.[0]?.replace("action_network:", "") ||
      "";

    tagRows.push({
      id: tagId,
      name: tag.name || "",
      created_date: tag.created_date || "",
      modified_date: tag.modified_date || "",
    });
  }

  writeCsv(path.join(dir, "tags.csv"), tagRows);
  console.log(`  Found ${tagRows.length} tags. Now fetching taggings for each …`);

  // Second pass: for each tag, get all taggings (person-tag links)
  for (const tag of tagRows) {
    let count = 0;
    try {
      for await (const tagging of paginate("v2", `tags/${tag.id}/taggings`, "osdi:taggings")) {
        const personHref = tagging._links?.["osdi:person"]?.href || "";
        assocRows.push({
          tag_id: tag.id,
          tag_name: tag.name,
          tagging_id: extractId(tagging._links?.self?.href) || "",
          person_id: extractId(personHref),
          created_date: tagging.created_date || "",
        });
        count++;
      }
    } catch (err) {
      console.log(`  ⚠ Could not fetch taggings for "${tag.name}": ${err.message}`);
    }
    if (count > 0) console.log(`    "${tag.name}" → ${count} taggings`);
  }

  writeCsv(path.join(dir, "tag_associations.csv"), assocRows);
  return { tags: tagRows.length, associations: assocRows.length };
}

// Run directly
if (process.argv[1]?.endsWith("export-tags.js")) {
  exportTags().catch((err) => {
    console.error("Export failed:", err.message);
    process.exit(1);
  });
}
