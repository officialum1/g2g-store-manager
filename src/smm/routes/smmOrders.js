const express = require("express");
const { query } = require("../../db");
const g2gClient = require("../../services/g2gClient");
const SmmOrder = require("../models/SmmOrder");

const router = express.Router();

router.use(express.json({ limit: "512kb" }));

function normalizeOrderId(value) {
  return String(value || "").trim();
}

function getDeliveryIdFromPayload(payload) {
  const deliveries =
    payload?.delivery_list ||
    payload?.deliveries ||
    (Array.isArray(payload) ? payload : []);
  const firstDelivery = Array.isArray(deliveries) ? deliveries[0] : null;

  return firstDelivery?.delivery_id || firstDelivery?.id || null;
}

function buildG2GProof(order) {
  const lines = [
    order.notes || "SMM delivery completed.",
    order.proof_url ? `Proof: ${order.proof_url}` : null,
    order.link ? `Target: ${order.link}` : null,
    order.quantity ? `Quantity: ${order.quantity}` : null
  ].filter(Boolean);

  return lines.join("\n");
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
  const axios = require("axios");
  const { buildHeaders } = require("../../services/g2gClient");
  const BASE = "https://open-api.g2g.com";

  try {
    const result = await db.query("SELECT * FROM smm_orders WHERE id=$1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Order not found" });

    const smmOrder = result.rows[0];
    const orderId = smmOrder.g2g_order_id;
    const notes = smmOrder.notes || "Order delivered successfully";
    const results = [];

    try {
      const p = `/v2/orders/${orderId}/deliveries`;
      const r = await axios.get(BASE + p, { headers: buildHeaders(p) });
      const list = r.data?.payload?.delivery_list || r.data?.payload?.deliveries || [];
      for (const d of list) {
        const did = d.delivery_id || d.id;
        if (did) {
          try {
            const pp = `/v2/orders/${orderId}/delivery/${did}`;
            const pr = await axios.patch(
              BASE + pp,
              { status: "delivered" },
              { headers: buildHeaders(pp) }
            );
            results.push({ method: "PATCH_delivery", delivery_id: did, status: pr.status, success: true });
          } catch (e) {
            results.push({
              method: "PATCH_delivery",
              delivery_id: did,
              status: e.response?.status,
              success: false,
              error: e.response?.data
            });
          }
        }
      }
    } catch (e) {
      results.push({ method: "GET_deliveries", status: e.response?.status, success: false });
    }

    if (smmOrder.g2g_delivery_id) {
      try {
        const p = `/v2/orders/${orderId}/delivery/${smmOrder.g2g_delivery_id}`;
        const r = await axios.patch(BASE + p, { status: "delivered" }, { headers: buildHeaders(p) });
        results.push({
          method: "PATCH_manual_delivery_id",
          delivery_id: smmOrder.g2g_delivery_id,
          status: r.status,
          success: true,
          data: r.data
        });
      } catch (e) {
        results.push({
          method: "PATCH_manual_delivery_id",
          delivery_id: smmOrder.g2g_delivery_id,
          status: e.response?.status,
          success: false,
          error: e.response?.data
        });
      }
    }

    try {
      const p = `/v2/orders/${orderId}/complete`;
      const r = await axios.post(BASE + p, {}, { headers: buildHeaders(p) });
      results.push({ method: "POST_complete", status: r.status, success: true, data: r.data });
    } catch (e) {
      results.push({ method: "POST_complete", status: e.response?.status, success: false, error: e.response?.data });
    }

    try {
      const p = `/v2/orders/${orderId}/proof`;
      const body = { proof: notes, proof_type: "text" };
      const r = await axios.post(BASE + p, body, { headers: buildHeaders(p) });
      results.push({ method: "POST_proof", status: r.status, success: true, data: r.data });
    } catch (e) {
      results.push({ method: "POST_proof", status: e.response?.status, success: false, error: e.response?.data });
    }

    try {
      const p = `/v2/orders/${orderId}`;
      const r = await axios.patch(BASE + p, { order_status: "delivered" }, { headers: buildHeaders(p) });
      results.push({ method: "PATCH_order", status: r.status, success: true, data: r.data });
    } catch (e) {
      results.push({ method: "PATCH_order", status: e.response?.status, success: false, error: e.response?.data });
    }

    const success = results.some((r) => r.success && (r.status === 200 || r.status === 201));

    if (success) {
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
    }

    res.json({
      success,
      orderId,
      message: success ? "G2G delivery successful!" : "All methods failed - check results",
      results
    });
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
