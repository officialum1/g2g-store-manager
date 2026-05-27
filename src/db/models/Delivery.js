const { query } = require("../index");

async function upsert({
  delivery_id,
  order_id,
  smm_order_id = null,
  status,
  codes_delivered = null,
  attempts = 0
}) {
  if (!delivery_id || !order_id || !status) {
    throw new Error("Delivery upsert requires delivery_id, order_id, and status.");
  }

  const result = await query(
    `
      INSERT INTO deliveries (
        delivery_id,
        order_id,
        smm_order_id,
        status,
        codes_delivered,
        attempts,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (delivery_id)
      DO UPDATE SET
        order_id = EXCLUDED.order_id,
        smm_order_id = EXCLUDED.smm_order_id,
        status = EXCLUDED.status,
        codes_delivered = EXCLUDED.codes_delivered,
        attempts = EXCLUDED.attempts,
        updated_at = NOW()
      RETURNING *
    `,
    [
      delivery_id,
      order_id,
      smm_order_id,
      status,
      codes_delivered ? JSON.stringify(codes_delivered) : null,
      attempts
    ]
  );

  return result.rows[0];
}

async function updateStatus(deliveryId, orderId, status, updates = {}) {
  const result = await query(
    `
      INSERT INTO deliveries (
        delivery_id,
        order_id,
        smm_order_id,
        status,
        codes_delivered,
        attempts,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (delivery_id)
      DO UPDATE SET
        order_id = EXCLUDED.order_id,
        smm_order_id = COALESCE(EXCLUDED.smm_order_id, deliveries.smm_order_id),
        status = EXCLUDED.status,
        codes_delivered = COALESCE(EXCLUDED.codes_delivered, deliveries.codes_delivered),
        attempts = EXCLUDED.attempts,
        updated_at = NOW()
      RETURNING *
    `,
    [
      deliveryId,
      orderId,
      updates.smm_order_id ?? null,
      status,
      updates.codes_delivered
        ? JSON.stringify(updates.codes_delivered)
        : null,
      updates.attempts ?? 0
    ]
  );

  return result.rows[0];
}

async function findByDeliveryId(deliveryId) {
  const result = await query(
    `
      SELECT *
      FROM deliveries
      WHERE delivery_id = $1
    `,
    [deliveryId]
  );

  return result.rows[0] || null;
}

async function list(limit = 100) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
  const result = await query(
    `
      SELECT *
      FROM deliveries
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [safeLimit]
  );

  return result.rows;
}

async function listByOrderId(orderId) {
  const result = await query(
    `
      SELECT *
      FROM deliveries
      WHERE order_id = $1
      ORDER BY created_at DESC
    `,
    [orderId]
  );

  return result.rows;
}

module.exports = {
  upsert,
  updateStatus,
  findByDeliveryId,
  list,
  listByOrderId
};
