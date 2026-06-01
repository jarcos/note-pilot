// Export Summary / Notes / Transcript to PDF or DOCX from canonical Markdown.
// electron is required lazily (inside exportPdf) so buildHtml/exportDocx are
// testable in plain Node.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { renderMarkdown } = require('../renderer/markdown');

// Node-side HTML escape (markdown.js takes an injectable esc).
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DOC_CSS = `
  body { font-family: -apple-system, system-ui, "Helvetica Neue", Arial, sans-serif;
         color:#1d1d1f; line-height:1.5; font-size:12pt; margin:2.2cm; }
  h1 { font-size:18pt; } h2 { font-size:15pt; } h3 { font-size:13pt; }
  h1,h2,h3 { margin:1em 0 .4em; }
  ul,ol { margin:.3em 0 .6em 1.4em; } li { margin:.15em 0; }
  table { border-collapse:collapse; margin:.6em 0; }
  th,td { border:1px solid #888; padding:4px 8px; text-align:left; vertical-align:top; }
  th { background:#f0f0f2; }
  .meta { color:#6e6e73; font-size:10pt; margin-bottom:1.2em; }
`;

function buildHtml({ title, subtitle, markdown }) {
  const body = renderMarkdown(markdown, esc);
  // Restrictive CSP: the export is styled static text/tables only — no scripts,
  // no remote resources. Defense-in-depth even though model output is escaped.
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>${DOC_CSS}</style></head><body>`
    + `<h1>${esc(title)}</h1>`
    + (subtitle ? `<div class="meta">${esc(subtitle)}</div>` : '')
    + body
    + `</body></html>`;
}

// Render a transcript (segments) into simple timestamped Markdown.
function transcriptToMarkdown(segments) {
  const fmt = (ms) => {
    if (ms == null) return '--:--';
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  return segments.map((s) => `**${fmt(s.fromMs)}** ${s.text}`).join('\n\n');
}

async function exportPdf(html, outPath) {
  const { BrowserWindow } = require('electron');
  // Render the HTML offscreen, then print to PDF. No CSP on this throwaway window.
  const tmpHtml = path.join(os.tmpdir(), `notepilot-export-${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadFile(tmpHtml);
    const pdf = await win.webContents.printToPDF({ printBackground: true, margins: { marginType: 'default' } });
    fs.writeFileSync(outPath, pdf);
  } finally {
    win.destroy();
    fs.unlink(tmpHtml, () => {});
  }
  return outPath;
}

async function exportDocx(html, outPath) {
  // html-to-docx is CJS and may export the fn under .default depending on version.
  const mod = require('html-to-docx');
  const HTMLtoDOCX = typeof mod === 'function' ? mod : mod.default;
  const buffer = await HTMLtoDOCX(html, null, { table: { row: { cantSplit: true } } });
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { buildHtml, transcriptToMarkdown, exportPdf, exportDocx };
