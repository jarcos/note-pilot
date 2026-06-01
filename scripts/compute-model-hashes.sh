#!/usr/bin/env bash
# Compute SHA-256 of the model files so you can pin them in src/main/model.js
# (MODEL_SHA256 / VAD_SHA256). Pinning makes the app reject a corrupted or
# tampered download instead of silently using it.
#
# Usage:  bash scripts/compute-model-hashes.sh
set -euo pipefail

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
VAD_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin"

echo "Downloading models to a temp dir (this fetches ~1.5GB once)…"
curl -L --fail -o "$TMP/model.bin" "$MODEL_URL"
curl -L --fail -o "$TMP/vad.bin"   "$VAD_URL"

echo ""
echo "Paste these into src/main/model.js:"
echo "  const MODEL_SHA256 = '$(shasum -a 256 "$TMP/model.bin" | awk '{print $1}')';"
echo "  const VAD_SHA256   = '$(shasum -a 256 "$TMP/vad.bin"   | awk '{print $1}')';"
