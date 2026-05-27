const { query, withTransaction } = require("../index");
const { config } = require("../../config");

const KNOWN_SETTING_KEYS = [
  "G2G_API_KEY",
  "G2G_API_SECRET",
  "G2G_WEBHOOK_SECRET",
  "G2G_OFFER_WEBHOOK_SECRET",
  "SMM_PANEL_URL",
  "SMM_PANEL_KEY"
];

const SECRET_KEY_PATTERN = /(secret|key)/i;

let ensureTablePromise = null;

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key || ""));
}

function maskSecretValue(value) {
  const normalized = String(value || "");

  if (!normalized) {
    return "";
  }

  if (normalized.length <= 4) {
    return "●".repeat(normalized.length);
  }

  return `${"●".repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}

function normalizeSettingEntry(entry = {}) {
  return {
    key: String(entry.key || "").trim(),
    value: entry.value == null ? "" : String(entry.value)
  };
}

async function ensureTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        "key" VARCHAR(255) NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch((error) => {
      ensureTablePromise = null;
      throw error;
    });
  }

  return ensureTablePromise;
}

function applyRuntimeSetting(key, value) {
  process.env[key] = value;

  if (key === "G2G_API_KEY") {
    config.g2g.apiKey = value;
    return;
  }

  if (key === "G2G_API_SECRET") {
    config.g2g.apiSecret = value;
    return;
  }

  if (key === "G2G_WEBHOOK_SECRET") {
    config.g2g.webhookSecret = value;
    return;
  }

  if (key === "SMM_PANEL_URL") {
    config.smm.baseUrl = value;
    return;
  }

  if (key === "SMM_PANEL_KEY") {
    config.smm.apiKey = value;
    return;
  }

  if (key === "PORT") {
    const parsedPort = Number.parseInt(value, 10);

    if (!Number.isNaN(parsedPort) && parsedPort > 0) {
      config.port = parsedPort;
    }
  }
}

async function getStoredSettingsMap() {
  await ensureTable();

  const result = await query(`
    SELECT "key", value, updated_at
    FROM app_settings
    ORDER BY "key" ASC
  `);

  return result.rows.reduce((accumulator, row) => {
    accumulator[row.key] = {
      key: row.key,
      value: row.value,
      updated_at: row.updated_at
    };
    return accumulator;
  }, {});
}

async function getAllSettings(options = {}) {
  const { masked = true, includeFallback = true } = options;
  const storedSettings = await getStoredSettingsMap();
  const output = {};

  Object.keys(storedSettings).forEach((key) => {
    const current = storedSettings[key];
    output[key] = {
      key,
      value: masked && isSecretKey(key)
        ? maskSecretValue(current.value)
        : current.value,
      is_secret: isSecretKey(key),
      is_masked: masked && isSecretKey(key),
      updated_at: current.updated_at
    };
  });

  if (includeFallback) {
    KNOWN_SETTING_KEYS.forEach((key) => {
      if (!output[key] && process.env[key]) {
        output[key] = {
          key,
          value: masked && isSecretKey(key)
            ? maskSecretValue(process.env[key])
            : String(process.env[key]),
          is_secret: isSecretKey(key),
          is_masked: masked && isSecretKey(key),
          updated_at: null
        };
      }
    });
  }

  return output;
}

async function upsertMany(entries = []) {
  const normalizedEntries = entries
    .map(normalizeSettingEntry)
    .filter((entry) => entry.key !== "");

  if (normalizedEntries.length === 0) {
    return [];
  }

  await ensureTable();

  return withTransaction(async (client) => {
    const savedRows = [];

    for (const entry of normalizedEntries) {
      const result = await client.query(
        `
          INSERT INTO app_settings ("key", value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT ("key")
          DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = NOW()
          RETURNING id, "key", value, updated_at
        `,
        [entry.key, entry.value]
      );

      if (result.rows[0]) {
        savedRows.push(result.rows[0]);
        applyRuntimeSetting(entry.key, entry.value);
      }
    }

    return savedRows;
  });
}

async function loadPersistedSettingsIntoRuntime() {
  const storedSettings = await getStoredSettingsMap();

  Object.values(storedSettings).forEach((entry) => {
    applyRuntimeSetting(entry.key, entry.value);
  });

  return storedSettings;
}

module.exports = {
  KNOWN_SETTING_KEYS,
  applyRuntimeSetting,
  ensureTable,
  getAllSettings,
  isSecretKey,
  loadPersistedSettingsIntoRuntime,
  maskSecretValue,
  upsertMany
};
