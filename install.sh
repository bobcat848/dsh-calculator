#!/usr/bin/env bash
# dsh-cost-tracker installer for macOS / Linux.
# Copies the plugin into the DSH web profile and registers the loader row.
# Idempotent: safe to re-run; existing rows are not duplicated.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILES_ROOT="$DSH_HOME/profiles"
DEST_DIR="$PROFILES_ROOT/node_modules/dsh-cost-tracker"
PATCH_FILE="$PROFILES_ROOT/web/cordis.patch.yml"

echo "Installing dsh-cost-tracker into $DEST_DIR"

# 1. Copy package files (hoisted node_modules root).
mkdir -p "$DEST_DIR/lib"
cp -f "$SCRIPT_DIR/package.json" "$DEST_DIR/"
cp -f "$SCRIPT_DIR/lib/client.js" "$DEST_DIR/lib/"
cp -f "$SCRIPT_DIR/lib/index.js" "$DEST_DIR/lib/"
echo "  copied lib/ and package.json"

# 2. Append the loader row to cordis.patch.yml if not already present.
if [ -f "$PATCH_FILE" ]; then
  if grep -q 'dsh-cost-tracker' "$PATCH_FILE"; then
    echo "  loader row already present, skipped"
  else
    cat >> "$PATCH_FILE" <<'EOF'

- insert:
    - id: dsh-cost-tracker
      name: 'dsh-cost-tracker'
      config: {}
EOF
    echo "  added loader row to $PATCH_FILE"
  fi
else
  echo "WARNING: $PATCH_FILE not found — create it with:" >&2
  echo "  - insert:" >&2
  echo "      - id: dsh-cost-tracker" >&2
  echo "        name: 'dsh-cost-tracker'" >&2
  echo "        config: {}" >&2
fi

echo "Done. Restart DSH web (e.g. 'dsh web --port 3080') and refresh http://127.0.0.1:3080"
