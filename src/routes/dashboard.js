const express = require("express");
const path = require("path");
const { query, withTransaction } = require("../db");
const Order = require("../db/models/Order");
const Delivery = require("../db/models/Delivery");
const { enqueueDeliveryJob } = require("../jobs/deliveryQueue");
const g2gClient = require("../services/g2gClient");

const dashboardApp = express();
const dashboardDirectory = path.join(__dirname, "..", "dashboard");

function normalizeDashboardStatus(order) {
  const orderStatus = String(order.status || "").toLowerCase();
  const deliveryStatus = String(order.latest_delivery_status || "").toLowerCase();

  if (
    orderStatus.includes("manual_pending") ||
    deliveryStatus.includes("manual_required")
  ) {
    return "manual_pending";
  }

  if (
    orderStatus.includes("awaiting_buyer_confirmation") ||
    orderStatus.includes("completed") ||
    orderStatus.includes("delivered") ||
    (
      Number.parseInt(order.delivered_qty || 0, 10) > 0 &&
      Number.parseInt(order.delivered_qty || 0, 10) >=
        Number.parseInt(order.purchased_qty || 0, 10)
    )
  ) {
    return "completed";
  }

  if (deliveryStatus.includes("fail") || orderStatus.includes("fail")) {
    return "failed";
  }

  if (
    orderStatus.includes("processing") ||
    orderStatus.includes("delivering") ||
    deliveryStatus.includes("processing") ||
    deliveryStatus.includes("posting") ||
    deliveryStatus.includes("reserved") ||
    deliveryStatus.includes("assigned")
  ) {
    return "delivering";
  }

  return "pending";
}

function maskInventoryContent(content) {
  const normalized = String(content || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= 4) {
    return "●".repeat(normalized.length);
  }

  const visibleStart = normalized.slice(0, 2);
  const visibleEnd = normalized.slice(-2);
  const maskLength = Math.max(4, Math.min(12, normalized.length - 4));

  return `${visibleStart}${"●".repeat(maskLength)}${visibleEnd}`;
}

function buildDashboardOrder(orderRow) {
  return {
    ...orderRow,
    dashboard_status: normalizeDashboardStatus(orderRow)
  };
}

async function listOrdersWithLatestDelivery(limit = 200) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 200;
  const result = await query(
    `
      WITH latest_delivery AS (
        SELECT DISTINCT ON (order_id)
          order_id,
          delivery_id,
          status AS latest_delivery_status,
          attempts AS latest_delivery_attempts,
          updated_at AS latest_delivery_updated_at
        FROM deliveries
        ORDER BY order_id, updated_at DESC, created_at DESC
      )
      SELECT
        o.order_id,
        o.offer_id,
        o.buyer_id,
        o.offer_type,
        o.status,
        o.purchased_qty,
        o.delivered_qty,
        o.raw_payload,
        o.created_at,
        o.updated_at,
        ld.delivery_id AS latest_delivery_id,
        ld.latest_delivery_status,
        ld.latest_delivery_attempts,
        ld.latest_delivery_updated_at
      FROM orders o
      LEFT JOIN latest_delivery ld
        ON ld.order_id = o.order_id
      ORDER BY o.created_at DESC
      LIMIT $1
    `,
    [safeLimit]
  );

  return result.rows.map(buildDashboardOrder);
}

async function getLatestDelivery(orderId) {
  const deliveries = await Delivery.listByOrderId(orderId);
  return deliveries[0] || null;
}

function buildRetryPayload(order, latestDelivery) {
  const rawPayload =
    order.raw_payload && typeof order.raw_payload === "object"
      ? order.raw_payload
      : {};

  const deliveryMethod = rawPayload.delivery_method
    ? rawPayload.delivery_method
    : rawPayload.delivery_summary
      ? {
          ...rawPayload.delivery_summary,
          delivery_method_list:
            rawPayload.delivery_summary.delivery_method_list || []
        }
      : {
          delivery_method_list:
            rawPayload.delivery_method_list ||
            rawPayload.additional_info_list ||
            []
        };

  return {
    order_id: order.order_id,
    offer_id: order.offer_id,
    offer_type: order.offer_type,
    buyer_id: order.buyer_id,
    buyer: rawPayload.buyer || {
      buyer_id: order.buyer_id
    },
    delivery_id: `local-${order.order_id}-retry-${Date.now()}`,
    delivery_method: deliveryMethod,
    purchased_qty: order.purchased_qty,
    delivered_qty: order.delivered_qty,
    raw_payload: {
      ...rawPayload,
      latest_delivery_id: latestDelivery?.delivery_id || null
    }
  };
}

function getNestedValue(source, paths) {
  for (const pathName of paths) {
    const value = pathName.split(".").reduce((current, key) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      return current[key];
    }, source);

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function normalizeG2GOrderPayload(order) {
  const orderId = getNestedValue(order, [
    "order_id",
    "orderId",
    "id",
    "order.id"
  ]);

  return {
    ...order,
    order_id: orderId,
    offer_id: getNestedValue(order, [
      "offer_id",
      "offerId",
      "offer.id",
      "listing_id",
      "product_id"
    ]),
    buyer_id: getNestedValue(order, [
      "buyer_id",
      "buyerId",
      "buyer.id",
      "buyer.user_id",
      "buyer.username"
    ]),
    offer_type: getNestedValue(order, [
      "offer_type",
      "offerType",
      "offer_service_type",
      "product_type",
      "delivery_type"
    ]),
    status: getNestedValue(order, [
      "status",
      "order_status",
      "orderStatus"
    ]) || "pending_delivery",
    purchased_qty: Number.parseInt(
      getNestedValue(order, [
        "purchased_qty",
        "purchasedQty",
        "quantity",
        "qty"
      ]) || 1,
      10
    ),
    delivered_qty: Number.parseInt(
      getNestedValue(order, [
        "delivered_qty",
        "deliveredQty",
        "delivered_quantity"
      ]) || 0,
      10
    ),
    raw_payload: order
  };
}

function getDeliveryIdFromOrder(order, latestDelivery) {
  const rawPayload =
    order.raw_payload && typeof order.raw_payload === "object"
      ? order.raw_payload
      : {};

  return (
    latestDelivery?.delivery_id ||
    rawPayload.delivery_id ||
    rawPayload.payload?.delivery_id ||
    rawPayload.delivery_summary?.delivery_id ||
    rawPayload.payload?.delivery_summary?.delivery_id ||
    null
  );
}

function registerParentRoutes(parentApp) {
  if (parentApp.locals.dashboardExtensionsRegistered) {
    return;
  }

  parentApp.locals.dashboardExtensionsRegistered = true;

  const ordersApiRouter = express.Router();
  const inventoryApiRouter = express.Router();

  ordersApiRouter.use(express.json({ limit: "256kb" }));
  inventoryApiRouter.use(express.json({ limit: "512kb" }));

  parentApp.get("/health", (req, res) => {
    return res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString()
    });
  });

  parentApp.get("/api/debug", async (req, res) => {
    let dbConnected = false;

    try {
      await query("SELECT 1");
      dbConnected = true;
    } catch (error) {
      console.error("[DEBUG] DB check failed:", error.message);
    }

    return res.json({
      g2g_api_key_set: Boolean(process.env.G2G_API_KEY),
      g2g_secret_set: Boolean(process.env.G2G_API_SECRET),
      webhook_secret_set: Boolean(process.env.G2G_WEBHOOK_SECRET),
      smm_url_set: Boolean(process.env.SMM_PANEL_URL),
      node_env: process.env.NODE_ENV || "development",
      db_connected: dbConnected
    });
  });

  parentApp.get("/api/g2g-test", async (req, res) => {
    try {
      const result = await g2gClient.getStoreSettings();
      res.json({ success: true, store: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  ordersApiRouter.get("/", async (req, res, next) => {
    try {
      const limit = Number.parseInt(req.query.limit || "200", 10);
      const orders = await listOrdersWithLatestDelivery(limit);

      return res.json({
        data: orders
      });
    } catch (error) {
      return next(error);
    }
  });

  ordersApiRouter.get("/lookup/:orderId", async (req, res) => {
    try {
      const order = await g2gClient.getOrderById(req.params.orderId);

      if (!order || !order.order_id) {
        return res.status(404).json({
          error: "Order not found in G2G response."
        });
      }

      const normalizedOrder = normalizeG2GOrderPayload(order);
      await query(
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
        `,
        [
          normalizedOrder.order_id,
          normalizedOrder.offer_id,
          normalizedOrder.buyer_id,
          normalizedOrder.offer_type,
          normalizedOrder.status,
          Number.isNaN(normalizedOrder.purchased_qty)
            ? 1
            : normalizedOrder.purchased_qty,
          Number.isNaN(normalizedOrder.delivered_qty)
            ? 0
            : normalizedOrder.delivered_qty,
          JSON.stringify(order)
        ]
      );

      return res.json({
        success: true,
        order
      });
    } catch (err) {
      return res.status(500).json({
        error: err.message
      });
    }
  });

  ordersApiRouter.get("/counts", async (req, res, next) => {
    try {
      const orders = await listOrdersWithLatestDelivery(1000);
      const counts = orders.reduce(
        (accumulator, order) => {
          if (order.dashboard_status === "pending") {
            accumulator.pending += 1;
          }

          if (order.dashboard_status === "failed") {
            accumulator.failed += 1;
          }

          if (order.dashboard_status === "manual_pending") {
            accumulator.manual_pending += 1;
          }

          return accumulator;
        },
        {
          pending: 0,
          failed: 0,
          manual_pending: 0
        }
      );

      return res.json(counts);
    } catch (error) {
      return next(error);
    }
  });

  ordersApiRouter.post("/:id/retry", async (req, res, next) => {
    try {
      const orderId = req.params.id;
      const order = await Order.findByOrderId(orderId);

      if (!order) {
        return res.status(404).json({
          error: "Order not found."
        });
      }

      const latestDelivery = await getLatestDelivery(orderId);
      const retryPayload = buildRetryPayload(order, latestDelivery);

      await Order.updateStatus(orderId, "pending_delivery", {
        raw_payload: retryPayload.raw_payload
      });

      const job = await enqueueDeliveryJob(retryPayload);

      return res.json({
        success: true,
        job_id: job.id,
        order_id: orderId
      });
    } catch (error) {
      return next(error);
    }
  });

  ordersApiRouter.post("/:id/complete", async (req, res, next) => {
    try {
      const orderId = req.params.id;
      const order = await Order.findByOrderId(orderId);

      if (!order) {
        return res.status(404).json({
          error: "Order not found."
        });
      }

      const manualDeliveryPayload = ["Delivered manually"];
      const latestDelivery = await getLatestDelivery(orderId);
      const deliveryId = getDeliveryIdFromOrder(order, latestDelivery);
      const rawPayload =
        order.raw_payload && typeof order.raw_payload === "object"
          ? order.raw_payload
          : {};

      if (!deliveryId) {
        return res.status(400).json({
          error: "Delivery ID is required to mark this order delivered in G2G."
        });
      }

      await g2gClient.deliverCode(orderId, deliveryId, manualDeliveryPayload);

      await Delivery.updateStatus(
        latestDelivery?.delivery_id || `manual-${orderId}`,
        orderId,
        "delivered",
        {
          attempts: latestDelivery?.attempts ?? 0,
          codes_delivered: manualDeliveryPayload
        }
      );

      const deliveredQty =
        Number.parseInt(order.purchased_qty ?? 0, 10) > 0
          ? Number.parseInt(order.purchased_qty, 10)
          : 1;

      const updatedOrder = await Order.updateStatus(orderId, "delivered", {
        delivered_qty: deliveredQty,
        raw_payload: {
          ...rawPayload,
          manual_delivery: true,
          manual_delivery_message: manualDeliveryPayload[0]
        }
      });

      return res.json({
        success: true,
        order_id: orderId,
        data: updatedOrder
      });
    } catch (error) {
      return next(error);
    }
  });

  inventoryApiRouter.get("/", async (req, res, next) => {
    try {
      const conditions = [];
      const values = [];
      const offerId = String(req.query.offer_id || "").trim();
      const status = String(req.query.status || "").trim();
      const limit = Number.parseInt(req.query.limit || "200", 10);
      const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 200;

      if (offerId) {
        values.push(offerId);
        conditions.push(`offer_id = $${values.length}`);
      }

      if (status) {
        values.push(status);
        conditions.push(`status = $${values.length}`);
      }

      values.push(safeLimit);

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const itemsResult = await query(
        `
          SELECT
            item_id,
            offer_id,
            content,
            content_type,
            status,
            delivered_to_order_id,
            created_at
          FROM inventory
          ${whereClause}
          ORDER BY created_at DESC, item_id DESC
          LIMIT $${values.length}
        `,
        values
      );

      const countsResult = await query(
        `
          SELECT
            offer_id,
            COUNT(*)::INTEGER AS available_count
          FROM inventory
          WHERE status = 'available'
          GROUP BY offer_id
          ORDER BY offer_id ASC
        `
      );

      return res.json({
        data: itemsResult.rows.map((item) => ({
          item_id: item.item_id,
          offer_id: item.offer_id,
          content_masked: maskInventoryContent(item.content),
          status: item.status,
          delivered_to_order_id: item.delivered_to_order_id,
          created_at: item.created_at
        })),
        counts: countsResult.rows
      });
    } catch (error) {
      return next(error);
    }
  });

  inventoryApiRouter.post("/bulk", async (req, res, next) => {
    try {
      const offerId = String(req.body.offer_id || "").trim();
      const items = Array.isArray(req.body.items)
        ? req.body.items
        : String(req.body.content || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line !== "");

      if (!offerId) {
        return res.status(400).json({
          error: "offer_id is required."
        });
      }

      if (items.length === 0) {
        return res.status(400).json({
          error: "At least one inventory item is required."
        });
      }

      const insertedItems = await withTransaction(async (client) => {
        const createdRows = [];

        for (const item of items) {
          const result = await client.query(
            `
              INSERT INTO inventory (
                offer_id,
                content,
                content_type,
                status,
                delivered_to_order_id,
                created_at
              )
              VALUES ($1, $2, 'text/plain', 'available', NULL, NOW())
              RETURNING item_id, offer_id, status, created_at
            `,
            [offerId, item]
          );

          if (result.rows[0]) {
            createdRows.push(result.rows[0]);
          }
        }

        return createdRows;
      });

      return res.status(201).json({
        success: true,
        created: insertedItems.length,
        data: insertedItems
      });
    } catch (error) {
      return next(error);
    }
  });

  inventoryApiRouter.post("/:itemId/defective", async (req, res, next) => {
    try {
      const itemId = Number.parseInt(req.params.itemId, 10);

      if (Number.isNaN(itemId)) {
        return res.status(400).json({
          error: "Invalid item id."
        });
      }

      const result = await query(
        `
          UPDATE inventory
          SET status = 'defective'
          WHERE item_id = $1
          RETURNING item_id, offer_id, status, delivered_to_order_id, created_at
        `,
        [itemId]
      );

      if (!result.rows[0]) {
        return res.status(404).json({
          error: "Inventory item not found."
        });
      }

      return res.json({
        success: true,
        data: result.rows[0]
      });
    } catch (error) {
      return next(error);
    }
  });

  parentApp.use("/api/orders", ordersApiRouter);
  parentApp.use("/api/inventory", inventoryApiRouter);
}

dashboardApp.on("mount", (parentApp) => {
  registerParentRoutes(parentApp);
});

dashboardApp.get("/", (req, res) => {
  return res.redirect("/dashboard/orders");
});

dashboardApp.get("/orders", (req, res) => {
  return res.sendFile(path.join(dashboardDirectory, "orders.html"));
});

dashboardApp.get("/inventory", (req, res) => {
  return res.sendFile(path.join(dashboardDirectory, "inventory.html"));
});

dashboardApp.get("/settings", (req, res) => {
  return res.sendFile(path.join(dashboardDirectory, "settings.html"));
});

dashboardApp.use(express.static(dashboardDirectory, { index: false }));

module.exports = dashboardApp;
