#!/usr/bin/env bash
# One-command release for Note Pilot (run on your Apple Silicon Mac).
# Builds the self-contained whisper-cli bundle, builds the unsigned DMG, and
# publishes a GitHub Release with BOTH assets. The installed app downloads the
# whisper bundle from `releases/latest/download/...` on first run.
#
# Requirements: gh (authenticated), node/npm, cmake, ffmpeg. Apple Silicon.
# Usage:  bash scripts/release.sh [version]      e.g. bash scripts/release.sh v0.1.0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="${1:-v0.1.0}"

echo "==> [1/4] Build self-contained whisper-cli bundle"
bash scripts/package-whisper.sh
WHISPER_TAR="$ROOT/dist-whisper/whisper-cli-macos-arm64.tar.gz"
[ -f "$WHISPER_TAR" ] || { echo "whisper bundle missing"; exit 1; }

echo "==> [2/4] Install deps + rebuild native module, then build DMG"
npm install
npm run rebuild
npm run dist
DMG="$(ls -t dist/*.dmg | head -1)"
[ -f "$DMG" ] || { echo "DMG not produced"; exit 1; }
echo "    DMG: $DMG"

echo "==> [3/4] Push any pending commits"
git push origin main 2>/dev/null || true

echo "==> [4/4] Create GitHub Release $VERSION with both assets"
gh release create "$VERSION" \
  "$DMG#Note Pilot (macOS, Apple Silicon, unsigned)" \
  "$WHISPER_TAR#whisper-cli-macos-arm64.tar.gz" \
  --title "Note Pilot $VERSION" \
  --notes "Local Whisper transcription + OpenRouter summaries/notes. Apple Silicon only. Unsigned — right-click → Open on first launch. The app downloads the Whisper model and speech engine on first transcription."

echo ""
echo "Done. Release: https://github.com/jarcos/note-pilot/releases/tag/$VERSION"
echo "The DMG is attached; the app will fetch whisper-cli + models on first run."
