#!/usr/bin/env node
/**
 * Export all donations from Action Network to CSV.
 *
 * Exports: id, donor_id, fundraising_page_id, amount, currency, recurrence,
 *          payment_method, referrer, created_date, modified_date.
 *
 * Uses the v1 /donations endpoint which returns all donations across all
 * fundraising pages.
 */
import path from "path";
import { paginate, extractId, writeCsv, getOutputDir } from "./lib.js";

export async function exportDonations(outputDir) {
  const dir = outputDir || getOutputDir();
  console.log("\n💰 Exporting donations …");

  const rows = [];

  for await (const donation of paginate("v1", "donations", "osdi:donations")) {
    const id =
      extractId(donation._links?.self?.href) ||
      donation.identifiers?.[0]?.replace("action_network:", "") ||
      "";

    // Extract linked person and fundraising page IDs from _links
    const personHref = donation._links?.["osdi:person"]?.href || "";
    const pageHref = donation._links?.["osdi:fundraising_page"]?.href || "";

    const row = {
      id,
      donor_person_id: extractId(personHref),
      fundraising_page_id: extractId(pageHref),
      amount: donation.amount || donation.total_amount || "",
      currency: donation.currency || "",
      recurring: donation.recurrence?.recurring ?? "",
      recurrence_period: donation.recurrence?.period || "",
      recipients: (donation.recipients || []).map((r) => r.display_name || r.amount).join("; "),
      referrer_data_source: donation.referrer_data?.source || "",
      referrer_data_url: donation.referrer_data?.url || "",
      referrer_data_website: donation.referrer_data?.website || "",
      action_network_status: donation.action_network?.status || "",
      created_date: donation.created_date || "",
      modified_date: donation.modified_date || "",
    };

    rows.push(row);
  }

  writeCsv(path.join(dir, "donations.csv"), rows);
  return rows.length;
}

// Run directly
if (process.argv[1]?.endsWith("export-donations.js")) {
  exportDonations().catch((err) => {
    console.error("Export failed:", err.message);
    process.exit(1);
  });
}
