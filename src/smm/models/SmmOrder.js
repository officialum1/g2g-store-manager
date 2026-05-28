const { query } = require("../../db");

const VALID_STATUSES = new Set(["pending", "processing", "completed", "failed"]);

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeStatus(status) {
  const value = String(status || "pending").trim().toLowerCase();
  return VALID_STATUSES.has(value) ? value : "pending";
}

async function list(filters = {}) {
  const conditions = [];
  const values = [];
  const status = String(filters.status || "").trim().toLowerCase();

  if (status && status !== "all") {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await query(
    `
      SELECT *
      FROM smm_orders
      ${whereClause}
      ORDER BY created_at DESC, id DESC
    `,
    values
  );

  return result.rows;
}

async function findById(id) {
  const result = await query(
    `
      SELECT *
      FROM smm_orders
      WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function findByG2GOrderId(g2gOrderId) {
  const result = await query(
    `
      SELECT *
      FROM smm_orders
      WHERE g2g_order_id = $1
    `,
    [g2gOrderId]
  );

  return result.rows[0] || null;
}

async function create(data) {
  const result = await query(
    `
      INSERT INTO smm_orders (
        g2g_order_id,
        g2g_offer_id,
        buyer_id,
        buyer_username,
        service_type,
        platform,
        link,
        quantity,
        status,
        proof_url,
        notes,
        g2g_delivery_id,
        g2g_delivered,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, $10, false, NOW(), NOW())
      ON CONFLICT (g2g_order_id)
      DO UPDATE SET
        g2g_offer_id = COALESCE(EXCLUDED.g2g_offer_id, smm_orders.g2g_offer_id),
        buyer_id = COALESCE(EXCLUDED.buyer_id, smm_orders.buyer_id),
        buyer_username = COALESCE(EXCLUDED.buyer_username, smm_orders.buyer_username),
        service_type = COALESCE(EXCLUDED.service_type, smm_orders.service_type),
        platform = COALESCE(EXCLUDED.platform, smm_orders.platform),
        link = COALESCE(NULLIF(EXCLUDED.link, ''), smm_orders.link),
        quantity = COALESCE(EXCLUDED.quantity, smm_orders.quantity),
        g2g_delivery_id = COALESCE(NULLIF(EXCLUDED.g2g_delivery_id, ''), smm_orders.g2g_delivery_id),
        updated_at = NOW()
      RETURNING *
    `,
    [
      data.g2g_order_id,
      data.g2g_offer_id || null,
      data.buyer_id || null,
      data.buyer_username || null,
      data.service_type || "views",
      data.platform || "tiktok",
      data.link || "",
      normalizeInteger(data.quantity, 1),
      normalizeStatus(data.status),
      data.g2g_delivery_id || null
    ]
  );

  return result.rows[0];
}

async function updateStatus(id, status, notes = null) {
  const result = await query(
    `
      UPDATE smm_orders
      SET status = $2,
          notes = COALESCE($3, notes),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, normalizeStatus(status), notes]
  );

  return result.rows[0] || null;
}

async function complete(id, { proof_url = null, notes = null } = {}) {
  const result = await query(
    `
      UPDATE smm_orders
      SET status = 'completed',
          proof_url = $2,
          notes = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, proof_url || null, notes || null]
  );

  return result.rows[0] || null;
}

async function setDeliveryId(id, deliveryId) {
  const result = await query(
    `
      UPDATE smm_orders
      SET g2g_delivery_id = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, deliveryId || null]
  );

  return result.rows[0] || null;
}

async function markG2GDelivered(id) {
  const result = await query(
    `
      UPDATE smm_orders
      SET g2g_delivered = true,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function stats() {
  const result = await query(
    `
      SELECT
        COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS pending,
        COUNT(*) FILTER (WHERE status = 'processing')::INTEGER AS processing,
        COUNT(*) FILTER (
          WHERE status = 'completed'
            AND updated_at >= date_trunc('day', NOW())
        )::INTEGER AS completed_today,
        COUNT(*) FILTER (WHERE status = 'completed')::INTEGER AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS failed
      FROM smm_orders
    `
  );

  return result.rows[0] || {
    total: 0,
    pending: 0,
    processing: 0,
    completed_today: 0,
    completed: 0,
    failed: 0
  };
}

module.exports = {
  create,
  complete,
  findByG2GOrderId,
  findById,
  list,
  markG2GDelivered,
  setDeliveryId,
  stats,
  updateStatus
};
