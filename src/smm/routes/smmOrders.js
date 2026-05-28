const express = require("express");
const g2gClient = require("../../services/g2gClient");
const SmmOrder = require("../models/SmmOrder");

const router = express.Router();

router.use(express.json({ limit: "512kb" }));

function normalizeOrderId(value) {
  return String(value || "").trim();
}

router.get("/api/orders", async (req, res, next) => {
  try {
    const orders = await SmmOrder.list({
      status: req.query.status
    });

    return res.json({
      data: orders
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/api/orders", async (req, res, next) => {
  try {
    const g2gOrderId = normalizeOrderId(req.body.g2g_order_id);
    const link = String(req.body.link || "").trim();
    const quantity = Number.parseInt(req.body.quantity, 10);

    if (!g2gOrderId) {
      return res.status(400).json({
        error: "g2g_order_id is required."
      });
    }

    if (!link) {
      return res.status(400).json({
        error: "link is required."
      });
    }

    if (Number.isNaN(quantity) || quantity <= 0) {
      return res.status(400).json({
        error: "quantity must be a positive number."
      });
    }

    const order = await SmmOrder.create({
      g2g_order_id: g2gOrderId,
      g2g_offer_id: req.body.g2g_offer_id || null,
      buyer_id: req.body.buyer_id || null,
      buyer_username: req.body.buyer_username || null,
      service_type: req.body.service_type || "views",
      platform: req.body.platform || "tiktok",
      link,
      quantity,
      g2g_delivery_id: req.body.g2g_delivery_id || null
    });

    return res.status(201).json({
      success: true,
      data: order
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/api/orders/:id", async (req, res, next) => {
  try {
    const order = await SmmOrder.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        error: "SMM order not found."
      });
    }

    return res.json({
      data: order
    });
  } catch (error) {
    return next(error);
  }
});

router.put("/api/orders/:id/status", async (req, res, next) => {
  try {
    const order = await SmmOrder.updateStatus(
      req.params.id,
      req.body.status,
      req.body.notes || null
    );

    if (!order) {
      return res.status(404).json({
        error: "SMM order not found."
      });
    }

    return res.json({
      success: true,
      data: order
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/api/orders/:id/complete", async (req, res, next) => {
  try {
    const order = await SmmOrder.complete(req.params.id, {
      proof_url: req.body.proof_url || null,
      notes: req.body.notes || null
    });

    if (!order) {
      return res.status(404).json({
        error: "SMM order not found."
      });
    }

    return res.json({
      success: true,
      data: order
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/api/orders/:id/set-delivery-id", async (req, res, next) => {
  try {
    const order = await SmmOrder.setDeliveryId(
      req.params.id,
      String(req.body.g2g_delivery_id || "").trim()
    );

    if (!order) {
      return res.status(404).json({
        error: "SMM order not found."
      });
    }

    return res.json({
      success: true,
      data: order
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/api/orders/:id/deliver-g2g", async (req, res) => {
  const db = require("../../db");

  try {
    const result = await db.query("SELECT * FROM smm_orders WHERE id=$1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Order not found" });

    const smmOrder = result.rows[0];
    const orderId = smmOrder.g2g_order_id;

    const { delivery_id: g2gDeliveryId } = await g2gClient.getDeliveries(orderId);
    const deliveryId = g2gDeliveryId || smmOrder.g2g_delivery_id;

    if (!deliveryId) {
      return res.status(400).json({
        error: "Delivery ID not found. Please enter it manually in the G2G Delivery ID field.",
        hint: "The delivery_id comes from G2G webhook. Check your webhook logs or G2G dashboard."
      });
    }

    try {
      const patchResult = await g2gClient.patchDelivery(
        orderId,
        deliveryId,
        smmOrder.quantity || 1
      );

      await db.query(
        `
          UPDATE smm_orders 
          SET g2g_delivered=true, status='completed', updated_at=NOW()
          WHERE id=$1
        `,
        [req.params.id]
      );

      await db.query(
        `
          UPDATE orders 
          SET status='delivered', delivered_qty=purchased_qty, updated_at=NOW() 
          WHERE order_id=$1
        `,
        [orderId]
      );

      return res.json({
        success: true,
        method: "patchDelivery",
        result: patchResult
      });
    } catch (error) {
      console.log("[SMM] patchDelivery failed, trying deliverCode:", error.message);
    }

    try {
      const codeResult = await g2gClient.deliverCode(orderId, deliveryId, [
        smmOrder.notes || "Delivered"
      ]);

      await db.query(
        `
          UPDATE smm_orders 
          SET g2g_delivered=true, status='completed', updated_at=NOW()
          WHERE id=$1
        `,
        [req.params.id]
      );

      await db.query(
        `
          UPDATE orders 
          SET status='delivered', delivered_qty=purchased_qty, updated_at=NOW() 
          WHERE order_id=$1
        `,
        [orderId]
      );

      return res.json({
        success: true,
        method: "deliverCode",
        result: codeResult
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  } catch (err) {
    console.error("[SMM] deliver-g2g error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/stats", async (req, res, next) => {
  try {
    const stats = await SmmOrder.stats();

    return res.json(stats);
  } catch (error) {
    return next(error);
  }
});

router.use((error, req, res, next) => {
  console.error("[SMM API] Unhandled error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: error.message || "Internal server error."
  });
});

module.exports = router;
