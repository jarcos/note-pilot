#!/usr/bin/env bash
# Spike A — whisper.cpp + Metal on Apple Silicon (RUN ON YOUR MAC).
#
# Proves the single biggest unknown: can we transcribe a real ~43-min Spanish
# lecture with large-v3-turbo, Metal-accelerated, fast enough? It reports
# wall-clock time and a transcript so you can eyeball accuracy.
#
# Requirements: macOS on Apple Silicon, Xcode command-line tools, cmake, ffmpeg.
#   xcode-select --install
#   brew install cmake ffmpeg
#
# Usage:  bash spikes/spikeA_whisper.sh "/path/to/lecture.m4a"
set -euo pipefail

AUDIO="${1:-Historia de la música clase 5 tercer trimestre EP 5.m4a}"
WORK="$(cd "$(dirname "$0")/.." && pwd)/.spike-whisper"
MODEL="ggml-large-v3-turbo.bin"
mkdir -p "$WORK"
cd "$WORK"

echo "==> 1/4 Building whisper.cpp with Metal"
if [ ! -d whisper.cpp ]; then
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git
fi
cd whisper.cpp
# Metal is enabled by default on Apple Silicon builds.
cmake -B build -DGGML_METAL=ON >/dev/null
cmake --build build -j --config Release >/dev/null
WHISPER_CLI="$(pwd)/build/bin/whisper-cli"
[ -x "$WHISPER_CLI" ] || WHISPER_CLI="$(pwd)/build/bin/main"  # older builds

echo "==> 2/4 Downloading $MODEL (~1.5GB, first run only)"
if [ ! -f "models/$MODEL" ]; then
  bash ./models/download-ggml-model.sh large-v3-turbo
fi

echo "==> 3/4 Decoding audio to 16kHz mono WAV"
WAV="$WORK/lecture_16k.wav"
ffmpeg -y -i "$AUDIO" -ar 16000 -ac 1 -c:a pcm_s16le "$WAV" -loglevel error

echo "==> 4/4 Transcribing (Spanish). Timing the run…"
START=$(date +%s)
"$WHISPER_CLI" -m "models/$MODEL" -f "$WAV" -l es -otxt -of "$WORK/lecture" --print-progress
END=$(date +%s)

AUDIO_SEC=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WAV")
ELAPSED=$((END-START))
echo ""
echo "================ SPIKE A RESULT ================"
printf "Audio length : %.0f s\n" "$AUDIO_SEC"
printf "Transcription: %d s\n" "$ELAPSED"
awk "BEGIN{printf \"Speed        : %.1fx realtime\n\", $AUDIO_SEC/$ELAPSED}"
echo "Transcript   : $WORK/lecture.txt"
echo "================================================"
echo "PASS if speed > 1x (faster than realtime) and the Spanish reads correctly."
head -c 1200 "$WORK/lecture.txt"; echo " …"
