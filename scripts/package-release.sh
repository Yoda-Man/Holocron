#!/usr/bin/env bash

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOWNLOADS_DIR="$(cd "$PLUGIN_DIR/../core/website/downloads" && pwd)"
ARCHIVE_PATH="$PLUGIN_DIR/holocron-vr-${npm_package_version}.zip"
WEBSITE_ARCHIVE_PATH="$DOWNLOADS_DIR/holocron-vr-${npm_package_version}.zip"

mkdir -p "$DOWNLOADS_DIR"
rm -f "$ARCHIVE_PATH" "$WEBSITE_ARCHIVE_PATH"

zip -qr "$ARCHIVE_PATH" \
  dist plugin.json assets frontend backend README.md USER_MANUAL.md \
  -x '*.DS_Store'

cp "$ARCHIVE_PATH" "$WEBSITE_ARCHIVE_PATH"

echo "Holocron VR distributable: $ARCHIVE_PATH"
echo "Website download: $WEBSITE_ARCHIVE_PATH"
