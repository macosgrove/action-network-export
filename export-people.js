#!/usr/bin/env node
/**
 * Export all people (contacts) from Action Network to CSV.
 *
 * Exports: id, email(s), given_name, family_name, phone, postal_code,
 *          locality, region, country, created_date, modified_date,
 *          languages_spoken, and all custom_fields.
 */
import path from "path";
import { paginate, extractId, writeCsv, getOutputDir } from "./lib.js";

export async function exportPeople(outputDir) {
  const dir = outputDir || getOutputDir();
  console.log("\n📋 Exporting people …");

  const rows = [];
  let customFieldKeys = new Set();

  for await (const person of paginate("v1", "people", "osdi:people")) {
    const id =
      extractId(person._links?.self?.href) ||
      person.identifiers?.[0]?.replace("action_network:", "") ||
      "";

    // Emails — take primary plus list all
    const emails = person.email_addresses || [];
    const primaryEmail = emails.find((e) => e.primary)?.address || emails[0]?.address || "";
    const allEmails = emails.map((e) => e.address).join("; ");

    // Phone
    const phones = person.phone_numbers || [];
    const primaryPhone = phones.find((p) => p.primary)?.number || phones[0]?.number || "";

    // Address (take first)
    const addr = (person.postal_addresses || [])[0] || {};

    // Custom fields — collect keys for later
    const cf = person.custom_fields || {};
    for (const key of Object.keys(cf)) customFieldKeys.add(key);

    const row = {
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
      // Custom fields get flattened into the row
      ...Object.fromEntries(
        Object.entries(cf).map(([k, v]) => [`custom_${k}`, v])
      ),
    };

    rows.push(row);
  }

  writeCsv(path.join(dir, "people.csv"), rows);
  console.log(`  Custom field columns found: ${[...customFieldKeys].join(", ") || "(none)"}`);
  return rows.length;
}

// Run directly
if (process.argv[1]?.endsWith("export-people.js")) {
  exportPeople().catch((err) => {
    console.error("Export failed:", err.message);
    process.exit(1);
  });
}
