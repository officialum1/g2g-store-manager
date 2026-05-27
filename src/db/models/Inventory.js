const { query, withTransaction } = require("../index");

async function createItem({
  offer_id,
  content,
  content_type = "text/plain",
  status = "available"
}) {
  const result = await query(
    `
      INSERT INTO inventory (
        offer_id,
        content,
        content_type,
        status,
        delivered_to_order_id,
        created_at
      )
      VALUES ($1, $2, $3, $4, NULL, NOW())
      RETURNING *
    `,
    [offer_id, content, content_type, status]
  );

  return result.rows[0];
}

async function reserveNextAvailable(offerId, orderId) {
  if (!offerId) {
    throw new Error("Inventory reservation requires offerId.");
  }

  if (!orderId) {
    throw new Error("Inventory reservation requires orderId.");
  }

  return withTransaction(async (client) => {
    const selectResult = await client.query(
      `
        SELECT item_id
        FROM inventory
        WHERE offer_id = $1
          AND status = 'available'
          AND delivered_to_order_id IS NULL
        ORDER BY created_at ASC, item_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
      [offerId]
    );

    if (selectResult.rows.length === 0) {
      return null;
    }

    const reservedItemId = selectResult.rows[0].item_id;
    const updateResult = await client.query(
      `
        UPDATE inventory
        SET delivered_to_order_id = $2
        WHERE item_id = $1
        RETURNING *
      `,
      [reservedItemId, orderId]
    );

    return updateResult.rows[0] || null;
  });
}

async function markDelivered(itemId, orderId) {
  const result = await query(
    `
      UPDATE inventory
      SET
        status = 'delivered',
        delivered_to_order_id = $2
      WHERE item_id = $1
        AND delivered_to_order_id = $2
        AND status = 'available'
      RETURNING *
    `,
    [itemId, orderId]
  );

  return result.rows[0] || null;
}

async function releaseReservation(itemId, orderId = null) {
  const params = [itemId];
  let filter = "";

  if (orderId) {
    params.push(orderId);
    filter = "AND delivered_to_order_id = $2";
  }

  const result = await query(
    `
      UPDATE inventory
      SET delivered_to_order_id = NULL
      WHERE item_id = $1
        AND status = 'available'
        ${filter}
      RETURNING *
    `,
    params
  );

  return result.rows[0] || null;
}

async function listByOffer(offerId, limit = 100) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
  const result = await query(
    `
      SELECT *
      FROM inventory
      WHERE offer_id = $1
      ORDER BY created_at ASC, item_id ASC
      LIMIT $2
    `,
    [offerId, safeLimit]
  );

  return result.rows;
}

module.exports = {
  createItem,
  reserveNextAvailable,
  markDelivered,
  releaseReservation,
  listByOffer
};
