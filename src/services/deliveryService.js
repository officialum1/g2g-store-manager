const Delivery = require("../db/models/Delivery");
const Inventory = require("../db/models/Inventory");
const Order = require("../db/models/Order");
const { postDelivery } = require("./g2gClient");
const inventoryService = require("./inventoryService");
const smmService = require("./smmService");

function normalizeOfferType(offerType) {
  const value = String(offerType || "")
    .trim()
    .toLowerCase();

  if (!value) {
    return "";
  }

  if (value.includes("boost")) {
    return "boosting";
  }

  if (value.includes("account")) {
    return "account";
  }

  if (
    value.includes("smm") ||
    value.includes("view") ||
    value.includes("follower") ||
    value.includes("like")
  ) {
    return "smm";
  }

  return value;
}

function getTrackingDeliveryId(jobData) {
  return jobData.delivery_id || `local-${jobData.order_id}`;
}

function getG2GDeliveryId(jobData) {
  if (!jobData.delivery_id) {
    return null;
  }

  return String(jobData.delivery_id).startsWith("local-")
    ? null
    : jobData.delivery_id;
}

function getBuyerId(jobData) {
  return (
    jobData.buyer_id ||
    jobData.buyer?.buyer_id ||
    jobData.buyer?.id ||
    null
  );
}

function buildAdditionalInfoMap(jobData) {
  const infoMap = {};
  const candidateLists = [
    jobData.delivery_method?.delivery_method_list,
    jobData.delivery_method?.additional_info_list,
    jobData.raw_payload?.delivery_summary?.delivery_method_list,
    jobData.raw_payload?.delivery_method_list
  ];

  candidateLists.forEach((list) => {
    if (!Array.isArray(list)) {
      return;
    }

    list.forEach((item, index) => {
      const key =
        item.attribute_key ||
        item.key ||
        item.name ||
        item.attribute_group_name ||
        `field_${index + 1}`;
      const value =
        item.value ??
        item.attribute_value ??
        item.attribute_values?.join(", ") ??
        item.attribute_group_value ??
        item.content ??
        null;

      if (value !== null && value !== undefined && value !== "") {
        infoMap[String(key).toLowerCase()] = value;
      }
    });
  });

  return infoMap;
}

function buildBoostingMessage(jobData, infoMap) {
  const lines = [
    "Boosting order accepted and assigned.",
    `Order ID: ${jobData.order_id}`,
    `Offer ID: ${jobData.offer_id || "unknown"}`,
    `Buyer ID: ${getBuyerId(jobData) || "unknown"}`,
    `Assigned At: ${new Date().toISOString()}`
  ];

  Object.entries(infoMap).forEach(([key, value]) => {
    lines.push(`${key}: ${value}`);
  });

  return lines.join("\n");
}

function extractSmmRequest(jobData, infoMap) {
  const lowerCaseEntries = Object.entries(infoMap);

  const serviceId =
    jobData.service_id ||
    jobData.delivery_method?.service_id ||
    jobData.buyer?.service_id ||
    lowerCaseEntries.find(([key]) => key.includes("service"))?.[1] ||
    null;

  const link =
    jobData.link ||
    jobData.delivery_method?.link ||
    jobData.buyer?.link ||
    lowerCaseEntries.find(([key]) => {
      return (
        key.includes("link") ||
        key.includes("url") ||
        key.includes("target")
      );
    })?.[1] ||
    lowerCaseEntries.find(([, value]) => {
      return typeof value === "string" && /^https?:\/\//i.test(value);
    })?.[1] ||
    null;

  const quantityValue =
    jobData.quantity ||
    jobData.delivery_method?.quantity ||
    jobData.raw_payload?.quantity ||
    lowerCaseEntries.find(([key]) => {
      return key.includes("quantity") || key.includes("qty");
    })?.[1] ||
    jobData.purchased_qty ||
    null;

  const quantity = Number.parseInt(quantityValue, 10);

  if (!serviceId) {
    throw new Error("Missing SMM serviceId in delivery payload.");
  }

  if (!link) {
    throw new Error("Missing SMM link in delivery payload.");
  }

  if (Number.isNaN(quantity) || quantity <= 0) {
    throw new Error("Missing valid SMM quantity in delivery payload.");
  }

  return {
    serviceId,
    link,
    quantity
  };
}

async function updateDeliveryProgress(
  deliveryId,
  orderId,
  status,
  updates = {}
) {
  return Delivery.updateStatus(deliveryId, orderId, status, updates);
}

async function finalizeOrderAfterDelivery(orderId, deliveredQty, rawPayload) {
  await Order.updateStatus(orderId, "awaiting_buyer_confirmation", {
    delivered_qty: deliveredQty,
    raw_payload: rawPayload
  });
}

async function handleBoosting(jobData, context) {
  const infoMap = buildAdditionalInfoMap(jobData);
  const deliveryPayload = [
    {
      content: buildBoostingMessage(jobData, infoMap),
      content_type: "text/plain"
    }
  ];

  await Order.updateStatus(jobData.order_id, "delivering", {
    raw_payload: jobData
  });
  await updateDeliveryProgress(
    context.deliveryId,
    jobData.order_id,
    "boosting_assigned",
    {
      attempts: context.attempts
    }
  );
  console.log("✅ [boosting assignment logged]");

  await updateDeliveryProgress(context.deliveryId, jobData.order_id, "posting_delivery", {
    attempts: context.attempts,
    codes_delivered: deliveryPayload
  });
  console.log("✅ [boosting delivery prepared]");

  let g2gResponse;

  try {
    g2gResponse = await postDelivery(
      jobData.order_id,
      deliveryPayload,
      context.g2gDeliveryId
    );
  } catch (error) {
    throw new Error(`Boosting G2G delivery failed: ${error.message}`);
  }

  await finalizeOrderAfterDelivery(
    jobData.order_id,
    Number.parseInt(jobData.purchased_qty ?? 1, 10) || 1,
    g2gResponse
  );
  await updateDeliveryProgress(context.deliveryId, jobData.order_id, "delivered", {
    attempts: context.attempts,
    codes_delivered: deliveryPayload
  });
  console.log("✅ [boosting delivery posted]");

  return g2gResponse;
}

async function handleAccount(jobData, context) {
  let reservedItem = null;

  try {
    reservedItem = await inventoryService.getNextAvailableItem(
      jobData.offer_id,
      jobData.order_id
    );
    await updateDeliveryProgress(
      context.deliveryId,
      jobData.order_id,
      "inventory_reserved",
      {
        attempts: context.attempts
      }
    );
    console.log("✅ [inventory item reserved]");

    const deliveryPayload = [
      {
        content: reservedItem.content,
        content_type: reservedItem.content_type
      }
    ];

    await updateDeliveryProgress(
      context.deliveryId,
      jobData.order_id,
      "posting_delivery",
      {
        attempts: context.attempts,
        codes_delivered: deliveryPayload
      }
    );
    console.log("✅ [account delivery prepared]");

    let g2gResponse;

    try {
      g2gResponse = await postDelivery(
        jobData.order_id,
        deliveryPayload,
        context.g2gDeliveryId
      );
    } catch (error) {
      throw new Error(`Account G2G delivery failed: ${error.message}`);
    }

    await inventoryService.markItemDelivered(
      reservedItem.item_id,
      jobData.order_id
    );
    console.log("✅ [inventory item marked delivered]");

    await finalizeOrderAfterDelivery(
      jobData.order_id,
      Number.parseInt(jobData.purchased_qty ?? 1, 10) || 1,
      g2gResponse
    );
    await updateDeliveryProgress(
      context.deliveryId,
      jobData.order_id,
      "delivered",
      {
        attempts: context.attempts,
        codes_delivered: deliveryPayload
      }
    );
    console.log("✅ [account delivery posted]");

    return g2gResponse;
  } catch (error) {
    if (reservedItem?.item_id) {
      await Inventory.releaseReservation(reservedItem.item_id, jobData.order_id);
    }

    throw error;
  }
}

async function handleSmm(jobData, context) {
  const infoMap = buildAdditionalInfoMap(jobData);
  const { serviceId, link, quantity } = extractSmmRequest(jobData, infoMap);

  let smmOrderId;

  try {
    smmOrderId = await smmService.placeOrder(serviceId, link, quantity);
  } catch (error) {
    throw new Error(`SMM order placement failed: ${error.message}`);
  }

  await updateDeliveryProgress(context.deliveryId, jobData.order_id, "smm_order_placed", {
    attempts: context.attempts,
    smm_order_id: String(smmOrderId)
  });
  console.log("✅ [smm panel order placed]");

  let finalSmmStatus;

  try {
    finalSmmStatus = await smmService.pollOrderUntilComplete(smmOrderId);
  } catch (error) {
    throw new Error(`SMM order polling failed: ${error.message}`);
  }

  await updateDeliveryProgress(context.deliveryId, jobData.order_id, "smm_completed", {
    attempts: context.attempts,
    smm_order_id: String(smmOrderId)
  });
  console.log("✅ [smm order completed]");

  const deliveryPayload = [
    {
      content: `SMM order ${smmOrderId} completed successfully for ${link}.`,
      content_type: "text/plain"
    }
  ];

  await updateDeliveryProgress(context.deliveryId, jobData.order_id, "posting_delivery", {
    attempts: context.attempts,
    smm_order_id: String(smmOrderId),
    codes_delivered: deliveryPayload
  });
  console.log("✅ [smm delivery prepared]");

  let g2gResponse;

  try {
    g2gResponse = await postDelivery(
      jobData.order_id,
      deliveryPayload,
      context.g2gDeliveryId
    );
  } catch (error) {
    throw new Error(`SMM G2G delivery failed: ${error.message}`);
  }

  await finalizeOrderAfterDelivery(
    jobData.order_id,
    Number.parseInt(jobData.purchased_qty ?? quantity, 10) || quantity,
    {
      g2g: g2gResponse,
      smm: finalSmmStatus
    }
  );
  await updateDeliveryProgress(context.deliveryId, jobData.order_id, "delivered", {
    attempts: context.attempts,
    smm_order_id: String(smmOrderId),
    codes_delivered: deliveryPayload
  });
  console.log("✅ [smm delivery posted]");

  return {
    g2g: g2gResponse,
    smm: finalSmmStatus
  };
}

async function processDeliveryJob(jobData, attempts = 1) {
  const deliveryId = getTrackingDeliveryId(jobData);
  const offerType = normalizeOfferType(jobData.offer_type);
  const context = {
    attempts,
    deliveryId,
    g2gDeliveryId: getG2GDeliveryId(jobData)
  };

  await Order.upsertFromPayload(jobData.raw_payload || jobData, {
    order_id: jobData.order_id,
    offer_id: jobData.offer_id,
    buyer_id: getBuyerId(jobData),
    offer_type: offerType || null,
    status: "processing_delivery",
    purchased_qty: Number.parseInt(jobData.purchased_qty ?? 0, 10),
    delivered_qty: Number.parseInt(jobData.delivered_qty ?? 0, 10),
    raw_payload: jobData
  });
  console.log("✅ [order record synchronized]");

  await updateDeliveryProgress(deliveryId, jobData.order_id, "processing", {
    attempts
  });
  console.log("✅ [delivery record initialized]");

  if (!offerType) {
    throw new Error(
      `Unable to determine offer type for order ${jobData.order_id}.`
    );
  }

  if (offerType === "boosting") {
    return handleBoosting(jobData, context);
  }

  if (offerType === "account") {
    return handleAccount(jobData, context);
  }

  if (offerType === "smm") {
    return handleSmm(jobData, context);
  }

  throw new Error(
    `Unsupported offer_type "${jobData.offer_type}" for order ${jobData.order_id}.`
  );
}

module.exports = {
  processDeliveryJob,
  normalizeOfferType
};
