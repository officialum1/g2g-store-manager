const crypto = require("crypto");
const express = require("express");
const { config } = require("../config");
const { logWebhookPayload } = require("../db");
const Order = require("../db/models/Order");
const { enqueueDeliveryJob } = require("../jobs/deliveryQueue");
const { normalizeOfferType } = require("../services/deliveryService");

const router = express.Router();

function createWebhookSignature(timestamp, rawBody) {
  return crypto
    .createHmac("sha256", config.g2g.webhookSecret)
    .update(`${timestamp}${rawBody}`)
    .digest("hex");
}

function verifyWebhookSignature(timestamp, signature, rawBody) {
  if (!timestamp || !signature) {
    return false;
  }

  const expectedSignature = createWebhookSignature(timestamp, rawBody);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(provided, expected);
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

function extractApiDeliveryPayload(payload = {}) {
  const orderId = getNestedValue(payload, [
    "order_id",
    "orderId",
    "order.id",
    "id"
  ]);
  const offerId = getNestedValue(payload, [
    "offer_id",
    "offerId",
    "offer.id",
    "listing_id",
    "product_id"
  ]);
  const buyerId = getNestedValue(payload, [
    "buyer_id",
    "buyerId",
    "buyer.id",
    "buyer.user_id",
    "buyer.username"
  ]);
  const purchasedQty = Number.parseInt(
    getNestedValue(payload, [
      "purchased_qty",
      "purchasedQty",
      "quantity",
      "qty"
    ]) || 1,
    10
  );
  const deliveredQty = Number.parseInt(
    getNestedValue(payload, [
      "delivered_qty",
      "deliveredQty",
      "delivered_quantity"
    ]) || 0,
    10
  );
  const deliveryId = getNestedValue(payload, [
    "delivery_id",
    "deliveryId",
    "delivery.id",
    "delivery_summary.delivery_id",
    "delivery_summary.id"
  ]);
  const offerType = normalizeOfferType(
    getNestedValue(payload, [
      "offer_type",
      "offerType",
      "offer_service_type",
      "product_type",
      "delivery_type"
    ])
  );
  const status =
    getNestedValue(payload, [
      "status",
      "order_status",
      "orderStatus"
    ]) || "pending_delivery";

  return {
    order_id: orderId,
    offer_id: offerId,
    buyer_id: buyerId,
    offer_type: offerType || null,
    status,
    purchased_qty: Number.isNaN(purchasedQty) ? 1 : purchasedQty,
    delivered_qty: Number.isNaN(deliveredQty) ? 0 : deliveredQty,
    delivery_id: deliveryId
  };
}

function buildDeliveryMethod(payload = {}) {
  return {
    ...(payload.delivery_summary || {}),
    delivery_method_list:
      payload.delivery_method_list ||
      payload.delivery_summary?.delivery_method_list ||
      []
  };
}

async function handleApiDeliveryEvent(payload, rawEvent) {
  const extracted = extractApiDeliveryPayload(payload);

  if (!extracted.order_id) {
    throw new Error("order.api_delivery webhook missing order_id.");
  }

  console.log("[WEBHOOK] order.api_delivery received:", extracted.order_id);

  await Order.upsertFromPayload(payload, {
    order_id: extracted.order_id,
    offer_id: extracted.offer_id,
    buyer_id: extracted.buyer_id,
    offer_type: extracted.offer_type,
    status: extracted.status,
    purchased_qty: extracted.purchased_qty,
    delivered_qty: extracted.delivered_qty,
    raw_payload: rawEvent
  });

  await enqueueDeliveryJob({
    order_id: extracted.order_id,
    offer_id: extracted.offer_id,
    offer_type: extracted.offer_type,
    buyer_id: extracted.buyer_id,
    buyer: payload.buyer || {
      buyer_id: extracted.buyer_id
    },
    delivery_id: extracted.delivery_id,
    delivery_method: buildDeliveryMethod(payload),
    purchased_qty: extracted.purchased_qty,
    delivered_qty: extracted.delivered_qty,
    raw_payload: payload
  });
}

async function handleOrderConfirmedEvent(payload, rawEvent) {
  const extracted = extractApiDeliveryPayload(payload);

  if (!extracted.order_id) {
    throw new Error("order.confirmed webhook missing order_id.");
  }

  await Order.upsertFromPayload(payload, {
    order_id: extracted.order_id,
    offer_id: extracted.offer_id,
    buyer_id: extracted.buyer_id,
    offer_type: extracted.offer_type,
    status: extracted.status || "confirmed",
    purchased_qty: extracted.purchased_qty,
    delivered_qty: extracted.delivered_qty,
    raw_payload: rawEvent
  });
}

async function processWebhookEvent(eventBody) {
  const eventType =
    eventBody.event || eventBody.type || eventBody.event_type || "";
  const payload = eventBody.payload || eventBody.data || {};

  if (eventType === "order.api_delivery") {
    await handleApiDeliveryEvent(payload, eventBody);
    return;
  }

  if (eventType === "order.confirmed") {
    await handleOrderConfirmedEvent(payload, eventBody);
    return;
  }

  console.log(`Ignored unsupported webhook event: ${eventType || "unknown"}`);
}

router.post("/g2g", express.raw({ type: "*/*" }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const timestamp = req.header("g2g-timestamp") || "";
  const signature = req.header("g2g-signature") || "";

  let parsedBody = null;

  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    parsedBody = null;
  }

  const eventId = parsedBody?.event_id || parsedBody?.id || null;
  const eventType =
    parsedBody?.event || parsedBody?.type || parsedBody?.event_type || null;

  try {
    await logWebhookPayload({
      eventId,
      eventType,
      rawBody,
      parsedPayload: parsedBody
    });
  } catch (error) {
    console.error("Failed to log webhook payload:", error.message);
  }

  if (!parsedBody) {
    return res.status(400).json({
      error: "Invalid JSON payload."
    });
  }

  if (!verifyWebhookSignature(timestamp, signature, rawBody)) {
    return res.status(401).json({
      error: "Invalid webhook signature."
    });
  }

  res.status(200).json({
    received: true
  });

  setImmediate(async () => {
    try {
      await processWebhookEvent(parsedBody);
    } catch (error) {
      console.error(
        `[ALERT] Async webhook processing failed for event ${
          eventId || "unknown"
        }: ${error.message}`
      );
    }
  });
});

module.exports = router;
