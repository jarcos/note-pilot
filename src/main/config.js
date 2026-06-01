// Local app config (OpenRouter key, model). Stored in userData/config.json.
// Not in the repo, so it's safe-ish for a personal/few-friends build.
const fs = require('fs');
const path = require('path');
const { dirs } = require('./paths');

function configPath() {
  return path.join(path.dirname(dirs.db()), 'config.json');
}

const DEFAULTS = {
  openRouterKey: '',
  model: 'openrouter/free', // robust auto-router; survives free-model churn
};

function readConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

function getApiKey() { return readConfig().openRouterKey || process.env.OPENROUTER_API_KEY || ''; }
function getModel() { return readConfig().model || DEFAULTS.model; }

// What the renderer is allowed to see — never the full key.
function publicSettings() {
  const c = readConfig();
  const key = c.openRouterKey || '';
  return {
    hasKey: Boolean(key) || Boolean(process.env.OPENROUTER_API_KEY),
    keyHint: key ? `…${key.slice(-4)}` : (process.env.OPENROUTER_API_KEY ? 'from env' : ''),
    model: c.model || DEFAULTS.model,
  };
}

module.exports = { readConfig, writeConfig, getApiKey, getModel, publicSettings, configPath };
