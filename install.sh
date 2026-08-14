#!/usr/bin/env bash
# dsh-cost-tracker installer for macOS / Linux.
# Two modes:
#   1. Local clone:  bash install.sh
#      (copies the package from this checked-out repo)
#   2. One-liner:    curl -fsSL https://raw.githubusercontent.com/bobcat848/dsh-calculator/main/install.sh | bash
#      (downloads the package straight from GitHub, no clone needed)
# Idempotent: safe to re-run; existing rows are not duplicated.
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILES_ROOT="$DSH_HOME/profiles"
DEST_DIR="$PROFILES_ROOT/node_modules/dsh-cost-tracker"
PATCH_FILE="$PROFILES_ROOT/web/cordis.patch.yml"

echo "Installing dsh-cost-tracker into $DEST_DIR"

mkdir -p "$DEST_DIR/lib"

# 1. Obtain the package files.
#    Local mode: running from a cloned checkout (BASH_SOURCE is a real file),
#    so copy the files next to the script. Remote mode (curl | bash):
#    BASH_SOURCE is empty, so download the three files from GitHub instead.
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cp -f "$SCRIPT_DIR/package.json" "$DEST_DIR/"
  cp -f "$SCRIPT_DIR/lib/client.js" "$DEST_DIR/lib/"
  cp -f "$SCRIPT_DIR/lib/index.js" "$DEST_DIR/lib/"
  echo "  copied package.json + lib/ (local: $SCRIPT_DIR)"
else
  BASE="https://raw.githubusercontent.com/bobcat848/dsh-calculator/main"
  echo "  downloading from $BASE ..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$BASE/package.json" -o "$DEST_DIR/package.json"
    curl -fsSL "$BASE/lib/client.js" -o "$DEST_DIR/lib/client.js"
    curl -fsSL "$BASE/lib/index.js" -o "$DEST_DIR/lib/index.js"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$BASE/package.json" -O "$DEST_DIR/package.json"
    wget -q "$BASE/lib/client.js" -O "$DEST_DIR/lib/client.js"
    wget -q "$BASE/lib/index.js" -O "$DEST_DIR/lib/index.js"
  else
    echo "ERROR: need curl or wget to download from GitHub" >&2
    exit 1
  fi
  echo "  downloaded package.json + lib/ (GitHub)"
fi

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
