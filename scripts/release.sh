#!/usr/bin/env bash
# One-command SIGNED + NOTARIZED release for Note Pilot (Apple Silicon Mac).
# Builds the whisper-cli bundle, builds + signs + notarizes the app, and
# publishes a GitHub Release (DMG + zip + latest-mac.yml for auto-update,
# plus the whisper bundle the app downloads on first run).
#
# Requirements:
#   - Developer ID Application cert installed (Xcode → Accounts → Manage Certificates)
#   - gh authenticated; cmake, ffmpeg, node installed
#   - Notarization env vars set:
#       export APPLE_ID="you@example.com"
#       export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
#       export APPLE_TEAM_ID="ABCDE12345"
#
# Usage:  bash scripts/release.sh v0.1.3
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
VERSION="${1:-v0.1.0}"; NUM="${VERSION#v}"

echo "==> Preflight"
command -v gh >/dev/null || { echo "gh not found"; exit 1; }
security find-identity -v -p codesigning | grep -q "Developer ID Application" \
  || { echo "No 'Developer ID Application' certificate in Keychain. Create one in Xcode → Settings → Accounts → Manage Certificates."; exit 1; }
: "${APPLE_ID:?set APPLE_ID}"; : "${APPLE_APP_SPECIFIC_PASSWORD:?set APPLE_APP_SPECIFIC_PASSWORD}"; : "${APPLE_TEAM_ID:?set APPLE_TEAM_ID}"

echo "==> [0/4] Sync package.json version to $NUM"
npm version "$NUM" --no-git-tag-version --allow-same-version >/dev/null
git add package.json package-lock.json 2>/dev/null || true
git commit -q -m "Release $VERSION" 2>/dev/null || true
git push -q origin main || true

echo "==> [1/4] Build + sign self-contained whisper-cli bundle"
bash scripts/package-whisper.sh
WHISPER_TAR="$ROOT/dist-whisper/whisper-cli-macos-arm64.tar.gz"
[ -f "$WHISPER_TAR" ] || { echo "whisper bundle missing"; exit 1; }

echo "==> [2/4] Install deps"
npm install

echo "==> [3/4] Build, sign, notarize, and publish (DMG + zip + latest-mac.yml)"
export GH_TOKEN="$(gh auth token)"
npx electron-builder --mac --arm64 --publish always

echo "==> [4/4] Attach the whisper bundle to the release"
gh release upload "$VERSION" "$WHISPER_TAR#whisper-cli-macos-arm64.tar.gz" --clobber

echo ""
echo "Done. Signed + notarized release: https://github.com/jarcos/note-pilot/releases/tag/$VERSION"
echo "Installed apps (>= this version) will now auto-update silently."
