// Lightweight update check against GitHub Releases. No auto-install (that needs
// code signing on macOS); just tells the user a newer version exists and links
// to the download.
const https = require('https');

const REPO = 'jarcos/note-pilot';

// Compare dotted versions ("v0.2.0" vs "0.1.0"); true if `latest` > `current`.
function isNewer(latest, current) {
  const norm = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = norm(latest); const b = norm(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0; const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/releases/latest`,
      headers: { 'User-Agent': 'NotePilot', Accept: 'application/vnd.github+json' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Returns { available, version, url } — never throws (offline = not available).
async function checkForUpdate(currentVersion) {
  try {
    const r = await fetchLatestRelease();
    const tag = r.tag_name || '';
    if (tag && isNewer(tag, currentVersion)) {
      return { available: true, version: tag.replace(/^v/, ''), url: r.html_url };
    }
    return { available: false };
  } catch (_) {
    return { available: false };
  }
}

module.exports = { checkForUpdate, isNewer };
