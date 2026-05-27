const cron = require("node-cron");
const Order = require("../db/models/Order");
const { enqueueDeliveryJob } = require("./deliveryQueue");
const { getOrders, getDeliveries } = require("../services/g2gClient");
const { normalizeOfferType } = require("../services/deliveryService");

let scheduledTask = null;

function extractOrderList(response) {
  return (
    response?.payload?.orders ||
    response?.payload?.order_list ||
    response?.data?.orders ||
    response?.orders ||
    []
  );
}

function extractDeliverySummary(response) {
  const deliveries =
    response?.payload?.deliveries ||
    response?.payload?.delivery_list ||
    response?.data?.deliveries ||
    response?.deliveries ||
    [];

  return deliveries[0]?.delivery_summary || deliveries[0] || null;
}

async function runOrderPoll() {
  let remoteOrders;

  try {
    const response = await getOrders({
      status: "pending_delivery"
    });
    remoteOrders = extractOrderList(response);
  } catch (error) {
    throw new Error(`Order poll failed while fetching orders: ${error.message}`);
  }

  for (const remoteOrder of remoteOrders) {
    try {
      const existingOrder = await Order.findByOrderId(remoteOrder.order_id);

      if (existingOrder) {
        continue;
      }

      const deliveriesResponse = await getDeliveries(remoteOrder.order_id);
      const deliverySummary = extractDeliverySummary(deliveriesResponse);
      const offerType = normalizeOfferType(
        remoteOrder.offer_type || remoteOrder.offer_service_type || null
      );
      const deliveryMethod = deliverySummary
        ? {
            ...deliverySummary,
            delivery_method_list: deliverySummary.delivery_method_list || []
          }
        : null;

      await Order.upsertFromPayload(remoteOrder, {
        offer_type: offerType || null,
        status: remoteOrder.order_status || "pending_delivery",
        raw_payload: remoteOrder
      });

      await enqueueDeliveryJob({
        order_id: remoteOrder.order_id,
        offer_id: remoteOrder.offer_id,
        offer_type: offerType || null,
        buyer_id: remoteOrder.buyer_id,
        buyer: {
          buyer_id: remoteOrder.buyer_id
        },
        delivery_id: deliverySummary?.delivery_id || null,
        delivery_method: deliveryMethod,
        purchased_qty: remoteOrder.purchased_qty,
        delivered_qty: remoteOrder.delivered_qty,
        raw_payload: remoteOrder
      });
    } catch (error) {
      console.error(
        `[ALERT] Order poll failed for ${remoteOrder.order_id}: ${error.message}`
      );
    }
  }
}

function startOrderPoller() {
  if (scheduledTask) {
    return scheduledTask;
  }

  scheduledTask = cron.schedule("*/5 * * * *", async () => {
    try {
      await runOrderPoll();
    } catch (error) {
      console.error("[ALERT] Order poller execution failed:", error.message);
    }
  });

  return scheduledTask;
}

module.exports = {
  startOrderPoller,
  runOrderPoll
};
