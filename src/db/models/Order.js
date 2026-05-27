const { query } = require("../index");

function normalizeOrderPayload(payload = {}, overrides = {}) {
  return {
    order_id: overrides.order_id || payload.order_id,
    offer_id: overrides.offer_id ?? payload.offer_id ?? null,
    buyer_id: overrides.buyer_id ?? payload.buyer_id ?? null,
    offer_type:
      overrides.offer_type ??
      payload.offer_type ??
      payload.offer_service_type ??
      null,
    status:
      overrides.status ??
      payload.status ??
      payload.order_status ??
      "pending_delivery",
    purchased_qty:
      overrides.purchased_qty ?? Number.parseInt(payload.purchased_qty ?? 0, 10),
    delivered_qty:
      overrides.delivered_qty ?? Number.parseInt(payload.delivered_qty ?? 0, 10),
    raw_payload: overrides.raw_payload ?? payload
  };
}

async function upsertFromPayload(payload = {}, overrides = {}) {
  const order = normalizeOrderPayload(payload, overrides);

  if (!order.order_id) {
    throw new Error("Order upsert requires order_id.");
  }

  const result = await query(
    `
      INSERT INTO orders (
        order_id,
        offer_id,
        buyer_id,
        offer_type,
        status,
        purchased_qty,
        delivered_qty,
        raw_payload,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (order_id)
      DO UPDATE SET
        offer_id = EXCLUDED.offer_id,
        buyer_id = EXCLUDED.buyer_id,
        offer_type = EXCLUDED.offer_type,
        status = EXCLUDED.status,
        purchased_qty = EXCLUDED.purchased_qty,
        delivered_qty = EXCLUDED.delivered_qty,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
      RETURNING *
    `,
    [
      order.order_id,
      order.offer_id,
      order.buyer_id,
      order.offer_type,
      order.status,
      order.purchased_qty,
      order.delivered_qty,
      JSON.stringify(order.raw_payload || {})
    ]
  );

  return result.rows[0];
}

async function updateStatus(orderId, status, updates = {}) {
  const result = await query(
    `
      UPDATE orders
      SET
        status = $2,
        delivered_qty = COALESCE($3, delivered_qty),
        raw_payload = COALESCE($4::jsonb, raw_payload),
        updated_at = NOW()
      WHERE order_id = $1
      RETURNING *
    `,
    [
      orderId,
      status,
      updates.delivered_qty ?? null,
      updates.raw_payload ? JSON.stringify(updates.raw_payload) : null
    ]
  );

  return result.rows[0] || null;
}

async function findByOrderId(orderId) {
  const result = await query(
    `
      SELECT *
      FROM orders
      WHERE order_id = $1
    `,
    [orderId]
  );

  return result.rows[0] || null;
}

async function list(limit = 100) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
  const result = await query(
    `
      SELECT *
      FROM orders
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [safeLimit]
  );

  return result.rows;
}

module.exports = {
  upsertFromPayload,
  updateStatus,
  findByOrderId,
  list
};
