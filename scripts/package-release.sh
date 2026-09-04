#!/usr/bin/env bash

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE_PATH="$PLUGIN_DIR/holocron-vr-${npm_package_version}.zip"

# The zip is the deliverable. Copying it next to the core checkout is a local
# convenience, so a missing sibling must not fail the build.
#
# This used to be `DOWNLOADS_DIR="$(cd "$PLUGIN_DIR/../core/website/downloads"
# && pwd)"` on line 2 of the script. Under `set -euo pipefail` that cd exits 1
# when the directory is absent — which is always true in CI, where this repo is
# checked out on its own. Every "Build plugin bundle" step failed for that
# reason, and nobody saw it because the workflow could not parse anyway.
DOWNLOADS_DIR="$PLUGIN_DIR/../core/website/downloads"

rm -f "$ARCHIVE_PATH"

zip -qr "$ARCHIVE_PATH" \
  dist plugin.json assets frontend backend README.md USER_MANUAL.md \
  -x '*.DS_Store'

echo "Holocron VR distributable: $ARCHIVE_PATH"

if [ -d "$(dirname "$DOWNLOADS_DIR")" ]; then
  mkdir -p "$DOWNLOADS_DIR"
  WEBSITE_ARCHIVE_PATH="$DOWNLOADS_DIR/holocron-vr-${npm_package_version}.zip"
  rm -f "$WEBSITE_ARCHIVE_PATH"
  cp "$ARCHIVE_PATH" "$WEBSITE_ARCHIVE_PATH"
  echo "Website download: $WEBSITE_ARCHIVE_PATH"
else
  echo "No core checkout beside this one; skipped the website copy."
fi
