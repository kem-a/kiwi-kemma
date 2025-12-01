#!/bin/bash
# Script to validate and compile translation files for Kiwi is not Apple.

set -euo pipefail

EXTENSION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PO_DIR="$EXTENSION_DIR/po"
LOCALE_DIR="$EXTENSION_DIR/locale"
DOMAIN="kiwi@kemma"

echo "Compiling translations for Kiwi is not Apple..."

echo "Checking syntax..."
if [ ! -d "$PO_DIR" ]; then
  echo "✗ Error: po/ directory not found"
  exit 1
fi

VALIDATION_FAILED=0
for po_file in "$PO_DIR"/*.po; do
  [ -f "$po_file" ] || continue
  lang=$(basename "$po_file" .po)
  printf "Validating %s... " "$lang"
  if msgfmt --check --verbose "$po_file" -o /dev/null >/dev/null 2>&1; then
    echo "✓"
  else
    echo "✗"
    msgfmt --check --verbose "$po_file" -o /dev/null || true
    VALIDATION_FAILED=1
  fi
done

if [ "$VALIDATION_FAILED" -ne 0 ]; then
  echo "✗ Translation validation failed."
  exit 1
fi

echo
echo "Building binary catalogs..."
mkdir -p "$LOCALE_DIR"
COMPILED=0
for po_file in "$PO_DIR"/*.po; do
  [ -f "$po_file" ] || continue
  lang=$(basename "$po_file" .po)
  output_dir="$LOCALE_DIR/$lang/LC_MESSAGES"
  output_file="$output_dir/$DOMAIN.mo"
  mkdir -p "$output_dir"
  printf "Compiling %s...\n" "$lang"
  if msgfmt --statistics "$po_file" -o "$output_file"; then
    COMPILED=$((COMPILED + 1))
  else
    echo "✗ Failed to compile $lang"
    exit 1
  fi
done

echo
echo "✓ Compiled $COMPILED translations into $LOCALE_DIR"
