const express = require("express");
const {
  getAllSettings,
  loadPersistedSettingsIntoRuntime,
  upsertMany
} = require("../db/models/AppSettings");

const router = express.Router();

router.use(express.json({ limit: "256kb" }));

void loadPersistedSettingsIntoRuntime().catch((error) => {
  console.error("Failed to load persisted app settings into runtime:", error);
});

function extractSettingEntries(body = {}) {
  if (Array.isArray(body.settings)) {
    return body.settings;
  }

  if (body.key) {
    return [
      {
        key: body.key,
        value: body.value
      }
    ];
  }

  return Object.entries(body).map(([key, value]) => ({
    key,
    value
  }));
}

router.get("/", async (req, res, next) => {
  try {
    const settings = await getAllSettings({
      masked: true,
      includeFallback: true
    });

    return res.json({
      data: settings
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const entries = extractSettingEntries(req.body);

    if (entries.length === 0) {
      return res.status(400).json({
        error: "No settings provided."
      });
    }

    const savedRows = await upsertMany(entries);
    const settings = await getAllSettings({
      masked: true,
      includeFallback: true
    });

    return res.json({
      success: true,
      saved: savedRows.map((row) => row.key),
      data: settings
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
