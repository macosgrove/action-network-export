#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <input.json>"
  exit 1
fi

INPUT="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for filter in "$SCRIPT_DIR"/export-csv/*-filter.json; do
  echo "--- $(basename "$filter") ---"
  node "$SCRIPT_DIR/export-csv/json-to-csv.js" "$INPUT" --filter "$filter"
done
