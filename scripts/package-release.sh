#!/usr/bin/env bash

set -euo pipefail

DOWNLOADS_DIR="/Users/marwamutemasango/Documents/yodaman/core/website/downloads"
ARCHIVE_PATH="$DOWNLOADS_DIR/holocron-vr-${npm_package_version}.zip"

mkdir -p "$DOWNLOADS_DIR"
rm -f "$ARCHIVE_PATH"

zip -qr "$ARCHIVE_PATH" \
  dist plugin.json assets frontend backend README.md USER_MANUAL.md \
  -x '*.DS_Store'

echo "Holocron VR distributable: $ARCHIVE_PATH"
