const dotenv = require("dotenv");

dotenv.config();

const requiredKeys = [
  "G2G_API_KEY",
  "G2G_API_SECRET",
  "G2G_WEBHOOK_SECRET"
];

const config = {
  port: Number.parseInt(process.env.PORT || "3000", 10),
  g2g: {
    baseUrl: "https://open-api.g2g.com/v1",
    apiKey: process.env.G2G_API_KEY || "",
    apiSecret: process.env.G2G_API_SECRET || "",
    webhookSecret: process.env.G2G_WEBHOOK_SECRET || ""
  },
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  smm: {
    baseUrl: process.env.SMM_PANEL_URL || "",
    apiKey: process.env.SMM_PANEL_KEY || ""
  },
  queue: {
    name: "deliveries",
    attempts: 5,
    backoffMs: 60_000
  }
};

function validateConfig() {
  console.log("[CONFIG] Loaded:", {
    hasG2GKey: Boolean(process.env.G2G_API_KEY),
    hasSMM: Boolean(process.env.SMM_PANEL_URL)
  });

  const missingKeys = requiredKeys.filter((key) => {
    return !process.env[key] || String(process.env[key]).trim() === "";
  });

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(", ")}`
    );
  }

  if (Number.isNaN(config.port) || config.port <= 0) {
    throw new Error("PORT must be a valid positive integer.");
  }
}

module.exports = {
  config,
  validateConfig
};
