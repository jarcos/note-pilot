#!/usr/bin/env bash
# Build a SELF-CONTAINED whisper-cli bundle for Apple Silicon and tar it for
# upload as a GitHub Release asset. The app downloads this on first run.
#
# Why: a Homebrew/cmake whisper-cli links against dylibs in /opt/homebrew that
# don't exist on a stranger's Mac. This builds from source, collects every
# non-system dylib next to the binary, and rewrites load paths to @loader_path
# so the bundle is relocatable.
#
# Requirements (on YOUR Mac, one time):  xcode-select --install ; brew install cmake
# Usage:    bash scripts/package-whisper.sh
# Output:   dist-whisper/whisper-cli-macos-arm64.tar.gz   <- upload to the Release
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/.whisper-build"
OUT="$ROOT/dist-whisper"
STAGE="$WORK/bundle"
mkdir -p "$WORK" "$OUT"

echo "==> 1/5 Clone + build whisper.cpp (Metal)"
[ -d "$WORK/whisper.cpp" ] || git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "$WORK/whisper.cpp"
cd "$WORK/whisper.cpp"
# GGML_NATIVE=OFF -> portable baseline (don't tune for the build machine's exact
# CPU), so the binary runs across all Apple Silicon generations, not just this one.
# Metal does the heavy lifting, so the CPU-tuning loss is negligible.
# Send build output (incl. harmless CMake/OpenMP warnings) to a log; surface it
# only if the build actually fails.
LOG="$WORK/build.log"
cmake -B build -DGGML_METAL=ON -DBUILD_SHARED_LIBS=ON -DGGML_NATIVE=OFF >"$LOG" 2>&1 \
  || { echo "cmake configure failed — see $LOG:"; tail -25 "$LOG"; exit 1; }
cmake --build build -j --config Release >>"$LOG" 2>&1 \
  || { echo "cmake build failed — see $LOG:"; tail -25 "$LOG"; exit 1; }
BIN="$(find build -name whisper-cli -type f | head -1)"
[ -x "$BIN" ] || { echo "build failed: whisper-cli not found"; exit 1; }

echo "==> 2/5 Stage binary"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp "$BIN" "$STAGE/whisper-cli"

# Recursively gather non-system dylibs a Mach-O references.
gather() {
  local f="$1"
  otool -L "$f" | tail -n +2 | awk '{print $1}' | while read -r dep; do
    case "$dep" in
      /usr/lib/*|/System/*) continue ;;                  # system libs: leave as-is
    esac
    local base; base="$(basename "$dep")"
    # resolve @rpath/@loader_path deps from the build tree
    local src="$dep"
    if [[ "$dep" == @* ]]; then
      src="$(find "$WORK/whisper.cpp/build" -name "$base" | head -1)"
    fi
    [ -f "$src" ] || continue
    if [ ! -f "$STAGE/$base" ]; then
      cp "$src" "$STAGE/$base"
      gather "$STAGE/$base"                                # recurse into its deps
    fi
  done
}

echo "==> 3/5 Collect dependent dylibs"
gather "$STAGE/whisper-cli"

echo "==> 4/5 Rewrite load paths to @loader_path"
cd "$STAGE"
for f in *; do
  [ "$f" = "whisper-cli" ] || install_name_tool -id "@loader_path/$f" "$f" 2>/dev/null || true
  otool -L "$f" | tail -n +2 | awk '{print $1}' | while read -r dep; do
    case "$dep" in /usr/lib/*|/System/*) continue ;; esac
    base="$(basename "$dep")"
    [ -f "$STAGE/$base" ] && install_name_tool -change "$dep" "@loader_path/$base" "$f" 2>/dev/null || true
  done
done
install_name_tool -add_rpath "@loader_path" whisper-cli 2>/dev/null || true
chmod 755 whisper-cli

# install_name_tool invalidates code signatures — re-sign. Prefer Developer ID
# (so the helper is properly signed for distribution); fall back to ad-hoc.
SIGN_ID="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application/{print $2; exit}')"
if [ -n "$SIGN_ID" ]; then IDENT="$SIGN_ID"; OPTS="--options runtime --timestamp"; echo "   re-signing with Developer ID: $SIGN_ID"; else IDENT="-"; OPTS=""; echo "   re-signing ad-hoc (no Developer ID found)"; fi
for f in *.dylib; do codesign --force $OPTS -s "$IDENT" "$f" 2>/dev/null || true; done
codesign --force $OPTS -s "$IDENT" whisper-cli 2>/dev/null || true

echo "==> 5/5 Smoke test + package"
./whisper-cli --help >/dev/null 2>&1 && echo "   bundle runs standalone OK" || echo "   WARN: standalone run failed — inspect otool -L whisper-cli"
TAR="$OUT/whisper-cli-macos-arm64.tar.gz"
tar -czf "$TAR" -C "$STAGE" .
echo "   bundle: $TAR"
