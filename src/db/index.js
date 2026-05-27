const { Pool } = require("pg");
const { config } = require("../config");

const pool = new Pool({
  connectionString: config.databaseUrl
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error);
});

async function query(text, params = [], client = pool) {
  return client.query(text, params);
}

async function withTransaction(work) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initializeDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      offer_id TEXT,
      buyer_id TEXT,
      offer_type TEXT,
      status TEXT NOT NULL,
      purchased_qty INTEGER NOT NULL DEFAULT 0,
      delivered_qty INTEGER NOT NULL DEFAULT 0,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS deliveries (
      delivery_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
      smm_order_id TEXT,
      status TEXT NOT NULL,
      codes_delivered JSONB,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS inventory (
      item_id BIGSERIAL PRIMARY KEY,
      offer_id TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('available', 'delivered', 'defective')),
      delivered_to_order_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT,
      event_type TEXT,
      raw_payload TEXT NOT NULL,
      parsed_payload JSONB,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_orders_offer_id
    ON orders (offer_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_deliveries_order_id
    ON deliveries (order_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_inventory_offer_id_status
    ON inventory (offer_id, status, delivered_to_order_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id
    ON webhook_logs (event_id)
  `);
}

async function logWebhookPayload({
  eventId = null,
  eventType = null,
  rawBody,
  parsedPayload = null
}) {
  await query(
    `
      INSERT INTO webhook_logs (event_id, event_type, raw_payload, parsed_payload, received_at)
      VALUES ($1, $2, $3, $4, NOW())
    `,
    [eventId, eventType, rawBody, parsedPayload]
  );
}

async function closeDatabase() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  withTransaction,
  initializeDatabase,
  logWebhookPayload,
  closeDatabase
};
