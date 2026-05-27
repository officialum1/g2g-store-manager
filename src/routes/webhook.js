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

async function handleApiDeliveryEvent(payload, rawEvent) {
  const existingOrder = await Order.findByOrderId(payload.order_id);
  const offerType = normalizeOfferType(
    payload.offer_type ||
      payload.offer_service_type ||
      existingOrder?.offer_type ||
      null
  );
  const deliveryMethod = {
    ...(payload.delivery_summary || {}),
    delivery_method_list:
      payload.delivery_method_list ||
      payload.delivery_summary?.delivery_method_list ||
      []
  };

  await Order.upsertFromPayload(payload, {
    offer_id: payload.offer_id || existingOrder?.offer_id || null,
    buyer_id: payload.buyer_id || existingOrder?.buyer_id || null,
    offer_type: offerType || null,
    status: payload.order_status || "pending_delivery",
    raw_payload: rawEvent
  });

  await enqueueDeliveryJob({
    order_id: payload.order_id,
    offer_id: payload.offer_id || existingOrder?.offer_id || null,
    offer_type: offerType || null,
    buyer_id: payload.buyer_id || existingOrder?.buyer_id || null,
    buyer: payload.buyer || {
      buyer_id: payload.buyer_id
    },
    delivery_id: payload.delivery_summary?.delivery_id || null,
    delivery_method: deliveryMethod,
    purchased_qty: payload.purchased_qty,
    delivered_qty: payload.delivered_qty,
    raw_payload: payload
  });
}

async function handleOrderConfirmedEvent(payload, rawEvent) {
  const offerType = normalizeOfferType(
    payload.offer_type || payload.offer_service_type || null
  );

  await Order.upsertFromPayload(payload, {
    offer_type: offerType || null,
    status: payload.order_status || "confirmed",
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
