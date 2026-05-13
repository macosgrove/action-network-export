# Action Network Data Export

Repeatable export of all Humanists Australia data from Action Network to CSV, for migration purposes.

## What gets exported

| File | Contents |
|---|---|
| `people.csv` | All contacts — name, email(s), phone, address, custom fields |
| `donations.csv` | All donation records — amount, currency, donor, fundraising page |
| `tags.csv` | Tag definitions — id, name, dates |
| `tag_associations.csv` | Which person has which tag |

## Prerequisites

- Node.js 18+
- Your Action Network API key (found in Settings → API & Sync)

## Setup

```bash
cd projects/action-network-export
npm install
```

## Usage

### Export everything at once

```bash
ACTION_NETWORK_API_KEY=your-key-here node run-export.js
```

### Export individual datasets

```bash
ACTION_NETWORK_API_KEY=your-key-here node export-people.js
ACTION_NETWORK_API_KEY=your-key-here node export-donations.js
ACTION_NETWORK_API_KEY=your-key-here node export-tags.js
```

### Output

Each run creates a dated folder under `output/`:

```
output/
  2026-04-28/
    people.csv
    donations.csv
    tags.csv
    tag_associations.csv
```

Run it again tomorrow and you get a fresh `2026-04-29/` snapshot — previous exports are preserved.

## Known limitations

- **Notes**: Action Network's API does not expose a notes endpoint. Notes will need to be exported manually from the Action Network admin UI (People → select contact → Notes). If notes are stored as custom fields, they will appear in the people export.
- **Rate limiting**: The scripts include a 300ms delay between pages. If you hit rate limits on a large dataset, increase `REQUEST_DELAY_MS` in `lib.js`.
- **API version**: People and donations use the v1 API. Tags use v2 (required by Action Network). Both use the same API key.
- **Page size**: Action Network caps pages at 25 items. The scripts paginate automatically.
