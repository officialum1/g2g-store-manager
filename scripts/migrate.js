const { Client } = require("pg");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("render.com")
    ? {
        rejectUnauthorized: false
      }
    : undefined
});

const migrations = [
  {
    name: "orders",
    sql: `
      CREATE TABLE IF NOT EXISTS orders (
        order_id VARCHAR PRIMARY KEY,
        offer_id VARCHAR,
        buyer_id VARCHAR,
        offer_type VARCHAR,
        status VARCHAR DEFAULT 'pending',
        purchased_qty INTEGER DEFAULT 1,
        delivered_qty INTEGER DEFAULT 0,
        raw_payload JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `
  },
  {
    name: "deliveries",
    sql: `
      CREATE TABLE IF NOT EXISTS deliveries (
        delivery_id VARCHAR PRIMARY KEY,
        order_id VARCHAR REFERENCES orders(order_id),
        smm_order_id VARCHAR,
        status VARCHAR DEFAULT 'pending',
        codes_delivered JSONB,
        attempts INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `
  },
  {
    name: "inventory",
    sql: `
      CREATE TABLE IF NOT EXISTS inventory (
        item_id SERIAL PRIMARY KEY,
        offer_id VARCHAR NOT NULL,
        content TEXT NOT NULL,
        content_type VARCHAR DEFAULT 'account',
        status VARCHAR DEFAULT 'available',
        delivered_to_order_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `
  },
  {
    name: "app_settings",
    sql: `
      CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `
  },
  {
    name: "smm_orders",
    sql: `
      CREATE TABLE IF NOT EXISTS smm_orders (
        id SERIAL PRIMARY KEY,
        g2g_order_id VARCHAR UNIQUE,
        g2g_offer_id VARCHAR,
        buyer_id VARCHAR,
        buyer_username VARCHAR,
        service_type VARCHAR,
        platform VARCHAR,
        link TEXT,
        quantity INTEGER,
        status VARCHAR DEFAULT 'pending',
        proof_url TEXT,
        notes TEXT,
        g2g_delivery_id VARCHAR,
        g2g_delivered BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `
  }
];

async function runMigrations() {
  try {
    await client.connect();

    for (const migration of migrations) {
      await client.query(migration.sql);
      console.log(`✅ ${migration.name} table ready`);
    }

    await client.end();
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);

    try {
      await client.end();
    } catch (closeError) {
      console.error("Failed to close database connection:", closeError);
    }

    process.exit(1);
  }
}

void runMigrations();
