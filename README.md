# Note Pilot

**Turn lecture recordings into transcripts, summaries, and structured study notes — on your own Mac.**

Note Pilot is a desktop app for students. Drop in a recording of a lecture and it:

1. **Transcribes** it locally with [Whisper](https://github.com/ggerganov/whisper.cpp) (`large-v3-turbo`, Metal-accelerated) — your audio never leaves your computer.
2. Generates a concise **Summary** and detailed **Structured Notes** via a free [OpenRouter](https://openrouter.ai) model.
3. Keeps everything in a **course-organized library** and exports to **PDF** or **Word (.docx)**.

> Built for Spanish + English lectures. Optimized for Apple Silicon Macs.

---

## Requirements

- **Apple Silicon Mac** (M1 or newer). Intel Macs are not supported yet.
- macOS 12 or later.
- A free **OpenRouter API key** (for summaries/notes — see below). Transcription works fully offline without it.
- ~2 GB free disk space (the Whisper model downloads on first use).

---

## Install

### Option A — Download the app (recommended)

1. Go to the [**Releases**](../../releases) page and download the latest `Note Pilot.dmg`.
2. Open the DMG and drag **Note Pilot** to Applications.
3. Launch it — the app is **signed and notarized by Apple**, so it opens normally with no security warnings.
4. On first transcription, Note Pilot downloads the Whisper model (~1.5 GB) and the speech-detection components. This is one-time.

**Updates are automatic.** When a new version is released, the app downloads it in the background and shows a "Restart to update" banner — no manual re-download.

### Option B — Run from source

```bash
git clone https://github.com/jarcos/note-pilot.git
cd note-pilot
npm install
npm run rebuild      # compiles the native SQLite module for Electron
npm start
```

---

## Getting your free OpenRouter API key

Transcription is free and offline. The **Summary** and **Notes** features use OpenRouter, which needs a free key. Here's how to get one and add it:

1. Go to **[openrouter.ai](https://openrouter.ai)** and click **Sign in** (you can use Google/GitHub). Creating an account is free and needs no credit card.
2. Once signed in, open the **Keys** page: **[openrouter.ai/keys](https://openrouter.ai/keys)** (your account menu → *Keys*).
3. Click **Create Key**, give it a name like `Note Pilot`, and click **Create**.
4. **Copy the key** — it looks like `sk-or-v1-…`. You won't be able to see it again, so copy it now.
5. In Note Pilot, click **⚙ Settings** (top-left), paste the key, and click **OK**.

That's it — the **Generate summary** and **Generate notes** buttons will now work.

### About the free tier

Note Pilot defaults to OpenRouter's **`openrouter/free`** auto-router, which picks from whatever free models are available (so it keeps working even when individual models change). Free models are rate-limited (roughly a couple hundred requests/day). Each lecture uses ~12–15 requests, so a few lectures a day is fine. If you hit limits often, adding a small one-time credit to your OpenRouter account raises the ceiling substantially.

---

## How to use

1. **Import** — drag a lecture audio file (`.m4a`, `.mp3`, `.wav`, …) onto the drop zone, or click to choose. Pick the language (defaults to Spanish).
2. **Transcribe** — watch the progress + timer; the transcript appears with timestamps and the lecture is saved to your library.
3. **Organize** — create courses (**+ Course**) and move lectures into them; rename or delete from the lecture toolbar.
4. **Summarize** — open the **Summary** or **Notes** tab and click **Generate**.
5. **Export** — use the **Export** buttons to save the current tab (Transcript / Summary / Notes) as **PDF** or **Word**.

---

## Privacy

- **Audio is processed entirely on your device** — recordings never leave your Mac.
- **Transcripts are sent to OpenRouter** when you generate a Summary or Notes. Free-tier AI providers may use submitted text to improve their models. Don't generate summaries for material you consider confidential. (You can skip generation entirely and just use the local transcript.)
- Your API key is stored locally in the app's data folder (`config.json`, owner-only permissions) and is never committed or sent anywhere except OpenRouter.

---

## Limitations

- Apple Silicon only (for now).
- Summaries/Notes are AI-generated: spot-check important facts against the transcript.

---

## How it works

Electron app. `whisper.cpp` (Metal) for transcription, `ffmpeg` for audio decoding, SQLite for the local library, and a map-reduce pipeline over the transcript for Summary/Notes via OpenRouter. Generated content is stored as Markdown and rendered to PDF (Chromium `printToPDF`) and DOCX (`html-to-docx`).

## License

MIT © José
